// The only place that touches SQLite. Everything else sends it a message.
import sqlite3InitModule from './vendor/sqlite/sqlite3.mjs';
import { fuse, normalizeUrl, PREFIX_FROM, toMatch } from './lib.js';

const SCHEMA = `
DROP TABLE IF EXISTS spike;

CREATE TABLE IF NOT EXISTS pages (
  id       INTEGER PRIMARY KEY,
  url      TEXT NOT NULL UNIQUE,
  title    TEXT NOT NULL,
  text     TEXT NOT NULL,
  hash     TEXT NOT NULL,
  first_at INTEGER NOT NULL,
  last_at  INTEGER NOT NULL,
  visits   INTEGER NOT NULL DEFAULT 1
);

CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  title, text,
  content='pages', content_rowid='id',
  tokenize='porter unicode61'
);

-- Browsing and the date filter both order by last_at. Without this index that is
-- a scan of every row, which measured 375 ms at 40,000 pages.
CREATE INDEX IF NOT EXISTS pages_by_last_at ON pages(last_at);

-- Term and document counts for the whole index, which is what makes it possible
-- to tell a rare word from a common one without storing a stopword list.
CREATE VIRTUAL TABLE IF NOT EXISTS pages_vocab USING fts5vocab(pages_fts, 'row');

-- Triggers are dropped and rebuilt on every start. An IF NOT EXISTS trigger keeps
-- whatever definition it was born with, so a database made last week would still
-- run last week's code. This costs nothing and removes that whole class of bug.
DROP TRIGGER IF EXISTS pages_ai;
DROP TRIGGER IF EXISTS pages_ad;
DROP TRIGGER IF EXISTS pages_au;

CREATE TRIGGER pages_ai AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(rowid, title, text) VALUES (new.id, new.title, new.text);
END;

CREATE TRIGGER pages_ad AFTER DELETE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title, text)
  VALUES ('delete', old.id, old.title, old.text);
END;

-- Reindexing is the expensive part, so it only runs when the text really changed.
CREATE TRIGGER pages_au AFTER UPDATE ON pages WHEN old.hash <> new.hash BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title, text)
  VALUES ('delete', old.id, old.title, old.text);
  INSERT INTO pages_fts(rowid, title, text) VALUES (new.id, new.title, new.text);
END;
`;

// Revisiting a page bumps the counters. The text is rewritten only when it changed.
const UPSERT = `
INSERT INTO pages (url, title, text, hash, first_at, last_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(url) DO UPDATE SET
  last_at = excluded.last_at,
  visits  = visits + 1,
  title   = CASE WHEN pages.hash <> excluded.hash THEN excluded.title ELSE pages.title END,
  text    = CASE WHEN pages.hash <> excluded.hash THEN excluded.text  ELSE pages.text  END,
  hash    = excluded.hash
`;

// Import merges, it does not overwrite. A page you already have keeps its earliest
// first visit and its highest visit count, and the newer copy wins on the text.
// This is why import cannot use UPSERT, which counts every write as a new visit.
const MERGE = `
INSERT INTO pages (url, title, text, hash, first_at, last_at, visits)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(url) DO UPDATE SET
  first_at = min(pages.first_at, excluded.first_at),
  last_at  = max(pages.last_at,  excluded.last_at),
  visits   = max(pages.visits,   excluded.visits),
  title    = CASE WHEN excluded.last_at > pages.last_at THEN excluded.title ELSE pages.title END,
  text     = CASE WHEN excluded.last_at > pages.last_at THEN excluded.text  ELSE pages.text  END,
  hash     = CASE WHEN excluded.last_at > pages.last_at THEN excluded.hash  ELSE pages.hash  END
`;

// char(1) and char(2) wrap each hit. They are control characters, not markup, so
// the page can escape the text first and turn them into <mark> after. Archived
// page content therefore can never become HTML.
const SEARCH = `
SELECT p.id, p.url, p.title, p.last_at, p.visits,
       snippet(pages_fts, 1, char(1), char(2), ' ... ', 24) AS excerpt
FROM pages_fts f
JOIN pages p ON p.id = f.rowid
WHERE pages_fts MATCH ? AND p.last_at >= ?
ORDER BY bm25(pages_fts, 10.0, 1.0)
LIMIT ?
`;

// The ranking pass. Ids only, because merging two rankings needs the order alone.
const SEARCH_IDS = `
SELECT f.rowid AS id
FROM pages_fts f
JOIN pages p ON p.id = f.rowid
WHERE pages_fts MATCH ? AND p.last_at >= ?
ORDER BY bm25(pages_fts, 10.0, 1.0)
LIMIT ?
`;

// The final pass. Its match holds the original query and the related words
// together, so a page found only by a related word still gets an excerpt.
const FETCH = `
SELECT p.id, p.url, p.title, p.last_at, p.visits,
       snippet(pages_fts, 1, char(1), char(2), ' ... ', 24) AS excerpt
FROM pages_fts f
JOIN pages p ON p.id = f.rowid
WHERE pages_fts MATCH ?
`;

// Shown when the box is empty, so the page is useful before you type anything.
const BROWSE = `
SELECT id, url, title, last_at, visits, substr(text, 1, 220) AS excerpt
FROM pages
WHERE last_at >= ?
ORDER BY last_at DESC
LIMIT ?
`;

async function sha256(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let db;

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  // The SAH pool driver needs no cross-origin isolation, unlike the other OPFS driver.
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'archive' });
  db = new pool.OpfsSAHPoolDb('/archive.db');
  db.exec(SCHEMA);
})();

// --- Development only, from here to the end of this block. -------------------
// This exists to answer one question: does search stay fast at 20,000 pages?
// ponytail: delete it once the numbers are in the README and stop changing.

// A flat word list would make the index unrealistically small, because real text
// repeats a few words constantly. Cubing the random number imitates that.
const VOCAB = Array.from({ length: 2000 }, (_, i) => `t${i}`);
const pick = () => VOCAB[Math.floor(VOCAB.length * Math.random() ** 3)];

function body(i) {
  const words = new Array(700);
  for (let w = 0; w < words.length; w++) words[w] = pick();
  words[Math.floor(Math.random() * words.length)] = `uniq${i}`; // one term only this page has
  return words.join(' ');
}

function seed(count) {
  const started = performance.now();
  const first = db.selectValue("SELECT count(*) FROM pages WHERE hash LIKE 'seed-%'");
  const insert = db.prepare(
    'INSERT OR IGNORE INTO pages (url, title, text, hash, first_at, last_at) VALUES (?,?,?,?,?,?)'
  );

  try {
    // One transaction, or every row pays for its own disk write.
    db.transaction(() => {
      for (let i = first; i < first + count; i++) {
        const when = Date.now() - Math.floor(Math.random() * 365 * 86400000);
        insert
          .bind([
            `https://seed${i % 200}.example/a/${i}`, // 200 hosts, so site deletion scales too
            `Seeded article ${i} about ${pick()} and ${pick()}`,
            body(i),
            `seed-${i}`, // the marker that makes these rows removable later
            when,
            when,
          ])
          .stepReset();
      }
    });
  } finally {
    insert.finalize();
  }

  return performance.now() - started;
}

function timeQuery(q, runs = 5) {
  const ms = [];
  let hits = 0;

  for (let r = 0; r < runs; r++) {
    const started = performance.now();
    hits = ops.search({ q, limit: 50 }).hits.length;
    ms.push(performance.now() - started);
  }

  ms.sort((a, b) => a - b);
  return { query: q || '(browse)', hits, medianMs: +ms[Math.floor(runs / 2)].toFixed(1) };
}
// --- End development only. ---------------------------------------------------

const EXPAND_BELOW = 10; // a search finding this few is a search that missed
const FEEDBACK_PAGES = 8;
const CANDIDATES = 60;
const RELATED_TERMS = 6;
const WORDS = /[a-z][a-z0-9']{2,}/g;

// When a search finds almost nothing, the few pages it did find are the best
// available guide to what you meant. Take their most distinctive words and search
// again with those. This needs no model and no download, because the meaning it
// uses is the one already sitting in your own archive.
//
// ponytail: it needs at least one hit to learn from. A word that appears nowhere
// in the archive stays unfindable, and no local method fixes that.
function relatedTerms(ids, alreadyTyped) {
  if (!ids.length) return [];

  const seeds = ids.slice(0, FEEDBACK_PAGES);
  const texts = db.selectValues(
    `SELECT title || ' ' || substr(text, 1, 4000) FROM pages WHERE id IN (${seeds
      .map(() => '?')
      .join(',')})`,
    seeds
  );

  const counts = new Map();
  for (const text of texts) {
    for (const word of text.toLowerCase().match(WORDS) ?? []) {
      if (alreadyTyped.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  if (!counts.size) return [];

  // Trim before asking the database, so the lookup stays one small query.
  const candidates = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, CANDIDATES);

  const pages = db.selectValue('SELECT count(*) FROM pages') || 1;
  const spread = new Map(
    db
      .selectObjects(
        `SELECT term, doc FROM pages_vocab WHERE term IN (${candidates.map(() => '?').join(',')})`,
        candidates.map(([term]) => term)
      )
      .map((row) => [row.term, row.doc])
  );

  // A word on every page tells you nothing, and a word on a few tells you a lot.
  // A word the index does not recognise counts as common, so it drops out rather
  // than being promoted. That is why no stopword list is needed here.
  return candidates
    .map(([term, seen]) => [term, seen * Math.log(pages / (1 + (spread.get(term) ?? pages)))])
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, RELATED_TERMS)
    .map(([term]) => term);
}

const ops = {
  save: async ({ url, title, text }) => {
    const now = Date.now();
    db.exec({ sql: UPSERT, bind: [normalizeUrl(url), title, text, await sha256(text), now, now] });
    return { pages: db.selectValue('SELECT count(*) FROM pages') };
  },

  search: ({ q = '', since = 0, limit = 50 }) => {
    const match = toMatch(q);
    if (!match) return { mode: 'browse', hits: db.selectObjects(BROWSE, [since, limit]) };

    // Rank once. The old code ranked the whole match twice on every keystroke,
    // once to decide whether to expand and once to fetch rows, which doubled the
    // cost of every search that did not need expanding, meaning almost all of them.
    const hits = db.selectObjects(SEARCH, [match, since, limit]);
    if (hits.length >= EXPAND_BELOW) return { mode: 'search', hits };

    // Below that line the query matched almost nothing, so it was cheap, and the
    // extra work that follows is affordable precisely because the search failed.
    const found = hits.map((hit) => hit.id);
    const typed = new Set(q.toLowerCase().match(WORDS) ?? []);
    const related = relatedTerms(found, typed);
    if (!related.length) return { mode: 'search', hits };

    const relatedMatch = related.map((t) => `"${t}"`).join(' OR ');
    const alsoFound = db.selectValues(SEARCH_IDS, [relatedMatch, since, 200]);

    // Two rankings, merged by position rather than by score. See fuse() in lib.js.
    const order = fuse([found, alsoFound]).slice(0, limit);
    if (!order.length) return { mode: 'search', hits };

    const rows = db.selectObjects(
      `${FETCH} AND p.id IN (${order.map(() => '?').join(',')})`,
      [`(${match}) OR (${relatedMatch})`, ...order]
    );

    const byId = new Map(rows.map((row) => [row.id, row]));
    return { mode: 'related', related, hits: order.map((id) => byId.get(id)).filter(Boolean) };
  },

  // Deleting is permanent, so each branch needs its own selector. There is no
  // path here that runs a DELETE without one.
  remove: ({ id, host, before }) => {
    if (id) {
      db.exec({ sql: 'DELETE FROM pages WHERE id = ?', bind: [id] });
      return { removed: db.changes() };
    }

    if (host) {
      db.exec({
        sql: "DELETE FROM pages WHERE url LIKE 'http://' || ?1 || '/%' OR url LIKE 'https://' || ?1 || '/%'",
        bind: [host],
      });
    } else if (before) {
      db.exec({ sql: 'DELETE FROM pages WHERE last_at < ?', bind: [before] });
    } else {
      throw new Error('remove needs id, host, or before');
    }

    const removed = db.changes();
    // A delete leaves markers behind in the index. This compacts them.
    // ponytail: it also runs on a huge index. Move it off the delete if it drags.
    if (removed) db.exec("INSERT INTO pages_fts(pages_fts) VALUES('optimize')");
    return { removed };
  },

  // Export walks the table by id, so a huge archive never has to fit in one message.
  exportPage: ({ after = 0, limit = 500 }) => ({
    rows: db.selectObjects(
      'SELECT id, url, title, text, first_at, last_at, visits FROM pages WHERE id > ? ORDER BY id LIMIT ?',
      [after, limit]
    ),
  }),

  // The hash is recomputed rather than trusted, because the update trigger uses it
  // to decide whether the search index needs rebuilding.
  merge: async ({ rows = [] }) => {
    const bindings = await Promise.all(
      rows.map(async (r) => [
        normalizeUrl(r.url),
        r.title,
        r.text,
        await sha256(r.text),
        r.first_at,
        r.last_at,
        r.visits,
      ])
    );

    const stmt = db.prepare(MERGE);
    try {
      // Hashing finished first, because a transaction callback cannot wait.
      db.transaction(() => {
        for (const bind of bindings) stmt.bind(bind).stepReset();
      });
    } finally {
      stmt.finalize();
    }

    return { merged: bindings.length };
  },

  // The last three fields answer one question: is the worker running the code on
  // disk? A benchmark measuring a stale build wastes an hour and looks like a
  // failed fix, which is exactly what happened once.
  stats: () => ({
    pages: db.selectValue('SELECT count(*) FROM pages'),
    chars: db.selectValue('SELECT coalesce(sum(length(text)), 0) FROM pages'),
    prefixFrom: PREFIX_FROM,
    hasIndex: !!db.selectValue(
      "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'pages_by_last_at'"
    ),
    ranksOnce: true,
  }),

  // Development only. Adds synthetic pages, then times five shapes of query.
  bench: ({ count = 5000 }) => {
    const seedMs = seed(count);
    const bytes = db.selectValue(
      'SELECT page_count * page_size FROM pragma_page_count, pragma_page_size'
    );

    return {
      pages: db.selectValue('SELECT count(*) FROM pages'),
      megabytes: +(bytes / 1048576).toFixed(1),
      seedSeconds: +(seedMs / 1000).toFixed(1),
      pagesPerSecond: Math.round(count / (seedMs / 1000)),
      queries: [
        't0', // a word on almost every page
        'uniq7', // a word on exactly one page
        't0 t3', // two words
        't1', // prefix, which is what typing produces
        '', // browse, with no query at all
      ].map((q) => timeQuery(q)),
    };
  },

  // Development only. Removes seeded rows and nothing else.
  unseed: () => {
    db.exec("DELETE FROM pages WHERE hash LIKE 'seed-%'");
    const removed = db.changes();
    if (!removed) return { removed };

    db.exec("INSERT INTO pages_fts(pages_fts) VALUES('optimize')");
    try {
      db.exec('VACUUM'); // gives the disk space back
    } catch {
      // ponytail: the file stays large. Harmless, because SQLite reuses the space.
    }
    return { removed };
  },
};

self.onmessage = async ({ data: { id, op, ...args } }) => {
  try {
    await ready;
    if (!ops[op]) throw new Error(`unknown op: ${op}`);
    self.postMessage({ id, ok: true, result: await ops[op](args) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) });
  }
};
