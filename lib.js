// Pure helpers, kept out of db-worker.js so `npm test` can run them in Node.
// These two functions are where silent damage happens. A missed parameter makes
// duplicate rows. A bad match string makes every search throw.

export const TRACKING = /^(utm_|fbclid$|gclid$|msclkid$|igshid$|mc_eid$|yclid$|ref_src$|_hsenc$|_hsmi$)/;

// Two links to the same article must become one row, so the noise comes off first.
// ponytail: a trailing slash still makes a second row. Fix it when a real site
// hands you both forms, because stripping it blindly breaks sites that use it.
export function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = '';
  u.hostname = u.hostname.replace(/^www\./, '');
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING.test(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  return u.toString();
}

// People paste whole addresses into the denylist box, so it is cleaned once here
// on the way in. Every stored entry is then a bare host, and the content script
// only has to compare strings.
export function parseDenylist(text) {
  const sites = new Set();

  for (const line of String(text).split('\n')) {
    const site = line
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[/?#].*$/, '');
    if (site) sites.add(site);
  }

  return [...sites];
}

// Reciprocal rank fusion. Two rankings disagree about scale, so comparing their
// scores directly needs weights nobody can tune honestly. Comparing positions
// needs none: a page both rankings place high wins, and a page only one of them
// found still gets through. The 60 is the constant from the original paper.
export function fuse(lists, k = 60) {
  const scores = new Map();

  for (const list of lists) {
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }

  // The id decides ties, so the same input always gives the same output.
  return [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
}

// An import file comes from outside, so every line is treated as hostile until it
// passes. A bad line is skipped and counted, never guessed at.
// Returns a clean row, or null when the line cannot be trusted.
export function parseRow(line) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }
  if (!row || typeof row !== 'object') return null;

  const { url, title, text } = row;
  if (typeof url !== 'string' || typeof title !== 'string' || typeof text !== 'string') return null;
  if (!text) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const first = Number(row.first_at);
  const last = Number(row.last_at);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;

  const visits = Math.floor(Number(row.visits));

  return {
    url,
    title,
    text,
    first_at: Math.min(first, last),
    last_at: Math.max(first, last),
    visits: Number.isFinite(visits) && visits > 0 ? visits : 1,
  };
}

// FTS5 has its own query grammar, so raw input throws on a hyphen or a quote.
// Every token is quoted, and the last one matches by prefix while you type.
export function toMatch(raw) {
  const tokens = String(raw).trim().split(/\s+/).filter(Boolean);
  return tokens
    .map((t, i) => `"${t.replace(/"/g, '""')}"` + (i === tokens.length - 1 ? '*' : ''))
    .join(' ');
}
