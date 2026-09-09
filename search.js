import { parseDenylist, parseRow } from './lib.js';

const BATCH = 500;

const input = document.getElementById('q');
const sinceEl = document.getElementById('since');
const olderEl = document.getElementById('older');
const purgeEl = document.getElementById('purge');
const pauseEl = document.getElementById('pause');
const denyEl = document.getElementById('deny');
const exportEl = document.getElementById('exportBtn');
const importEl = document.getElementById('importFile');
const statusEl = document.getElementById('status');
const list = document.getElementById('results');

const ask = (op, args) => chrome.runtime.sendMessage({ type: 'db', op, ...args });

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESCAPES[c]);

// The snippet query wraps each hit in char(1) and char(2). Escape the text first,
// then swap those two markers for tags. Archived page text can never become markup.
const OPEN = String.fromCharCode(1);
const CLOSE = String.fromCharCode(2);
const highlight = (s) => esc(s).split(OPEN).join('<mark>').split(CLOSE).join('</mark>');

const day = (ms) => new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const host = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const LABEL = { search: 'matching', browse: 'recent', related: 'matching or related' };

function render({ mode, hits, related }) {
  if (!hits.length) {
    statusEl.textContent = input.value.trim()
      ? 'Nothing matches.'
      : 'Nothing archived yet. Read an article for five seconds.';
    list.innerHTML = '';
    return;
  }

  // Saying which words were added keeps a surprising result explainable.
  statusEl.textContent =
    `${hits.length} ${LABEL[mode] ?? 'matching'} ${hits.length === 1 ? 'page' : 'pages'}` +
    (related?.length ? `. Also searched: ${related.join(', ')}` : '');

  list.innerHTML = hits
    .map((h) => {
      const site = host(h.url);
      return `<li>
        <a href="${esc(h.url)}">${esc(h.title)}</a>
        <div class="meta">
          ${esc(site)} &middot; ${day(h.last_at)}${h.visits > 1 ? ` &middot; ${h.visits} visits` : ''}
          &middot; <button type="button" data-act="page" data-id="${h.id}">Delete page</button>
          &middot; <button type="button" data-act="site" data-host="${esc(site)}">Delete site</button>
        </div>
        <p class="excerpt">${highlight(h.excerpt ?? '')}</p>
      </li>`;
    })
    .join('');
}

let seq = 0;

async function run() {
  const mine = ++seq;
  const days = Number(sinceEl.value);
  const reply = await ask('search', {
    q: input.value,
    since: days ? Date.now() - days * 86400000 : 0,
  });

  if (mine !== seq) return; // a later keystroke already won
  if (!reply?.ok) {
    statusEl.textContent = `Search failed: ${reply?.error ?? 'no reply'}`;
    return;
  }
  render(reply.result);
}

// Deleting cannot be undone, so every path asks first and says what it removed.
async function remove(args, question) {
  if (!confirm(`${question}\n\nThis cannot be undone.`)) return;

  const reply = await ask('remove', args);
  if (!reply?.ok) {
    statusEl.textContent = `Delete failed: ${reply?.error ?? 'no reply'}`;
    return;
  }

  await run();
  statusEl.textContent = `Deleted ${plural(reply.result.removed, 'page')}.`;
}

let debounce;
input.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(run, 120);
});
sinceEl.addEventListener('change', run);

// One listener for every row, because the rows are rebuilt on each search.
list.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-act]');
  if (!button) return;

  const { act, id, host: site } = button.dataset;
  if (act === 'page') return remove({ id: Number(id) }, 'Delete this page?');
  return remove({ host: site }, `Delete every page from ${site}?`);
});

purgeEl.addEventListener('click', () => {
  const days = Number(olderEl.value);
  const label = olderEl.options[olderEl.selectedIndex].text;
  return remove(
    { before: Date.now() - days * 86400000 },
    `Delete every page older than ${label}?`
  );
});

// The content script reads these two settings straight from storage, so writing
// them here is the whole implementation. There is no message to send.
async function loadSettings() {
  const { paused = false, denylist = [] } = await chrome.storage.local.get(['paused', 'denylist']);
  pauseEl.checked = paused;
  denyEl.value = denylist.join('\n');
}

async function saveDenylist() {
  const denylist = parseDenylist(denyEl.value);
  await chrome.storage.local.set({ denylist });
  return denylist;
}

pauseEl.addEventListener('change', () => chrome.storage.local.set({ paused: pauseEl.checked }));

let denyTimer;
denyEl.addEventListener('input', () => {
  clearTimeout(denyTimer);
  denyTimer = setTimeout(saveDenylist, 400); // save while you type, so nothing is lost
});

// Tidy the box only when you leave it, so it never rewrites under your cursor.
denyEl.addEventListener('blur', async () => {
  denyEl.value = (await saveDenylist()).join('\n');
});

// One JSON object per line. No header and no wrapper, so any single line stands
// on its own, and grep, split and tail all work on the file.
async function exportArchive() {
  const lines = [];
  let after = 0;

  for (;;) {
    const reply = await ask('exportPage', { after, limit: BATCH });
    if (!reply?.ok) {
      statusEl.textContent = `Export failed: ${reply?.error ?? 'no reply'}`;
      return;
    }

    const { rows } = reply.result;
    if (!rows.length) break;

    // The id is local to this database, so it is not part of the file.
    for (const { id, ...row } of rows) lines.push(JSON.stringify(row));
    after = rows[rows.length - 1].id;
    statusEl.textContent = `Exporting ${lines.length} pages...`;
  }

  const url = URL.createObjectURL(
    new Blob([lines.join('\n')], { type: 'application/x-ndjson' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `archive-${new Date().toISOString().slice(0, 10)}.ndjson`;
  link.click();
  URL.revokeObjectURL(url);

  statusEl.textContent = `Exported ${plural(lines.length, 'page')}.`;
}

async function send(rows) {
  const reply = await ask('merge', { rows });
  if (!reply?.ok) throw new Error(reply?.error ?? 'no reply');
  return reply.result.merged;
}

async function importArchive(file) {
  statusEl.textContent = 'Reading the file...';
  // ponytail: the whole file is read into memory. Stream it if a file ever chokes.
  const text = await file.text();

  let merged = 0;
  let skipped = 0;
  let batch = [];

  try {
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;

      const row = parseRow(line);
      if (!row) {
        skipped++;
        continue;
      }

      batch.push(row);
      if (batch.length < BATCH) continue;

      merged += await send(batch);
      batch = [];
      statusEl.textContent = `Imported ${merged} pages...`;
    }

    if (batch.length) merged += await send(batch);
  } catch (err) {
    statusEl.textContent = `Import stopped after ${merged} pages: ${err.message}`;
    return;
  }

  await run();
  statusEl.textContent = skipped
    ? `Imported ${plural(merged, 'page')}. Skipped ${plural(skipped, 'unreadable line')}.`
    : `Imported ${plural(merged, 'page')}.`;
}

exportEl.addEventListener('click', exportArchive);

importEl.addEventListener('change', async () => {
  const [file] = importEl.files;
  if (!file) return;
  await importArchive(file);
  importEl.value = ''; // so picking the same file again still fires
});

// Down and up move through the results. Enter opens the focused link natively.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const links = [...list.querySelectorAll('a')];
  if (!links.length) return;
  e.preventDefault();

  const at = links.indexOf(document.activeElement);
  if (e.key === 'ArrowUp' && at <= 0) return input.focus();
  links[e.key === 'ArrowDown' ? Math.min(at + 1, links.length - 1) : at - 1].focus();
});

loadSettings();
run();
