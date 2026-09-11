import { parseDenylist, parseRow } from './lib.js';

const BATCH = 500;

const $ = (id) => document.getElementById(id);
const input = $('q');
const sinceEl = $('since');
const statusEl = $('status');
const relatedEl = $('related');
const list = $('results');
const emptyEl = $('empty');
const filterEl = $('filter');
const filterHostEl = $('filterHost');
const statsEl = $('stats');
const allCountEl = $('allCount');
const siteListEl = $('siteList');
const sitesNav = siteListEl.parentElement;
const dialog = $('settings');
const pauseEl = $('pause');
const denyEl = $('deny');
const olderEl = $('older');
const purgeEl = $('purge');
const exportEl = $('exportBtn');
const importEl = $('importFile');

const ask = (op, args) => chrome.runtime.sendMessage({ type: 'db', op, ...args });

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESCAPES[c]);

// The snippet query wraps each hit in char(1) and char(2). Escape the text first,
// then swap those two markers for tags. Archived page text can never become markup.
const OPEN = String.fromCharCode(1);
const CLOSE = String.fromCharCode(2);
const highlight = (s) => esc(s).split(OPEN).join('<mark>').split(CLOSE).join('</mark>');

const day = (ms) => new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' });
const n = (x) => Number(x).toLocaleString();
const plural = (count, word) => `${n(count)} ${word}${count === 1 ? '' : 's'}`;

// Chrome serves these from its own favicon cache. No request leaves the machine.
const favicon = (url) =>
  `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=32`;

const iconFor = (url) => `<img class="favicon" src="${favicon(url)}" alt="" width="16" height="16" />`;

// The one piece of state the page holds. Empty means every site.
let activeHost = '';
let totalPages = 0;

// --- Sidebar -----------------------------------------------------------------

function size(chars) {
  return chars >= 1048576 ? `${(chars / 1048576).toFixed(1)} MB` : `${Math.round(chars / 1024)} KB`;
}

async function renderSidebar() {
  const [stats, sites] = await Promise.all([ask('stats'), ask('sites')]);
  if (!stats?.ok || !sites?.ok) return;

  totalPages = stats.result.pages;
  statsEl.innerHTML = `<strong>${n(totalPages)}</strong> ${totalPages === 1 ? 'page' : 'pages'}
    &middot; ${size(stats.result.chars)} of text`;
  allCountEl.textContent = n(totalPages);

  siteListEl.innerHTML = sites.result.sites
    .map(
      ({ host, pages }) => `<button type="button" class="site" data-host="${esc(host)}"
        ${host === activeHost ? 'aria-current="true"' : ''}>
        ${iconFor(`https://${host}/`)}
        <span class="site-name">${esc(host)}</span>
        <span class="site-count">${n(pages)}</span>
      </button>`
    )
    .join('');

  markActiveSite();
}

function markActiveSite() {
  for (const button of sitesNav.querySelectorAll('.site')) {
    const current = button.dataset.host === activeHost;
    if (current) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }

  filterEl.hidden = !activeHost;
  filterHostEl.textContent = activeHost;
}

function setHost(host) {
  activeHost = host;
  markActiveSite();
  run();
}

sitesNav.addEventListener('click', (e) => {
  const button = e.target.closest('.site');
  if (button) setHost(button.dataset.host);
});

$('clearFilter').addEventListener('click', () => setHost(''));

// --- Results -----------------------------------------------------------------

const LABEL = { search: 'matching', browse: 'recent', related: 'matching or related' };

function showEmpty(kind) {
  emptyEl.hidden = !kind;
  if (!kind) return;

  if (kind === 'archive') {
    emptyEl.innerHTML = `
      <h2>Nothing archived yet</h2>
      <p>Archive keeps the text of articles you read, on this computer only. A page is saved when:</p>
      <ul>
        <li>You keep it visible for five seconds.</li>
        <li>It has no password field.</li>
        <li>It reads as an article of at least 500 characters.</li>
      </ul>
      <p>Read something now, then come back.</p>`;
    return;
  }

  const hints = [];
  if (sinceEl.value !== '0') hints.push('set the range to Any time');
  if (activeHost) hints.push('clear the site filter');
  const query = input.value.trim();

  emptyEl.innerHTML = `
    <h2>${query ? `Nothing matches &ldquo;${esc(query)}&rdquo;` : 'Nothing here'}</h2>
    <p>${['Try fewer words', ...hints].join(', or ')}.</p>`;
}

function render({ mode, hits, related }) {
  relatedEl.hidden = !related?.length;
  relatedEl.innerHTML = (related ?? [])
    .map((word) => `<button type="button" class="chip" data-word="${esc(word)}">${esc(word)}</button>`)
    .join('');

  if (!hits.length) {
    list.innerHTML = '';
    statusEl.textContent = '';
    const untouched = !input.value.trim() && !activeHost && sinceEl.value === '0';
    showEmpty(untouched && totalPages === 0 ? 'archive' : 'search');
    return;
  }

  showEmpty(null);

  // Saying which words were added keeps a surprising result explainable.
  statusEl.textContent =
    `${n(hits.length)} ${LABEL[mode] ?? 'matching'} ${hits.length === 1 ? 'page' : 'pages'}` +
    (related?.length ? '. Also searched:' : '');

  list.innerHTML = hits
    .map(
      (h) => `<li class="hit">
        <div class="hit-meta">
          ${iconFor(h.url)}
          <span>${esc(h.host)}</span>
          <span>&middot;</span>
          <span>${day(h.last_at)}</span>
          ${h.visits > 1 ? `<span>&middot;</span><span>${n(h.visits)} visits</span>` : ''}
          <span class="hit-actions">
            <button type="button" data-act="page" data-id="${h.id}">Delete page</button>
            <button type="button" data-act="site" data-host="${esc(h.host)}">Delete site</button>
          </span>
        </div>
        <a class="hit-title" href="${esc(h.url)}">${esc(h.title)}</a>
        <p class="hit-excerpt">${highlight(h.excerpt ?? '')}</p>
      </li>`
    )
    .join('');
}

let seq = 0;

async function run() {
  const mine = ++seq;
  const days = Number(sinceEl.value);
  const reply = await ask('search', {
    q: input.value,
    since: days ? Date.now() - days * 86400000 : 0,
    host: activeHost,
  });

  if (mine !== seq) return; // a later keystroke already won
  if (!reply?.ok) {
    statusEl.textContent = `Search failed: ${reply?.error ?? 'no reply'}`;
    return;
  }
  render(reply.result);
}

let debounce;
input.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(run, 120);
});
sinceEl.addEventListener('change', run);

// A related word is one click from becoming part of the query.
relatedEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  input.value = `${input.value.trim()} ${chip.dataset.word}`.trim();
  input.focus();
  run();
});

// --- Deleting ----------------------------------------------------------------

// Deleting cannot be undone, so every path asks first and says what it removed.
async function remove(args, question) {
  if (!confirm(`${question}\n\nThis cannot be undone.`)) return;

  const reply = await ask('remove', args);
  if (!reply?.ok) {
    statusEl.textContent = `Delete failed: ${reply?.error ?? 'no reply'}`;
    return;
  }

  if (args.host && args.host === activeHost) activeHost = '';
  await Promise.all([renderSidebar(), run()]);
  statusEl.textContent = `Deleted ${plural(reply.result.removed, 'page')}.`;
}

// One listener for every row, because the rows are rebuilt on each search.
list.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-act]');
  if (!button) return;

  const { act, id, host } = button.dataset;
  if (act === 'page') return remove({ id: Number(id) }, 'Delete this page?');
  return remove({ host }, `Delete every page from ${host}?`);
});

purgeEl.addEventListener('click', () => {
  const days = Number(olderEl.value);
  const label = olderEl.options[olderEl.selectedIndex].text;
  return remove({ before: Date.now() - days * 86400000 }, `Delete every page older than ${label}?`);
});

// --- Settings ----------------------------------------------------------------

$('settingsBtn').addEventListener('click', () => dialog.showModal());
$('closeSettings').addEventListener('click', () => dialog.close());

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

// --- Export and import -------------------------------------------------------

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
    statusEl.textContent = `Exporting ${n(lines.length)} pages...`;
  }

  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'application/x-ndjson' }));
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
      statusEl.textContent = `Imported ${n(merged)} pages...`;
    }

    if (batch.length) merged += await send(batch);
  } catch (err) {
    statusEl.textContent = `Import stopped after ${n(merged)} pages: ${err.message}`;
    return;
  }

  await Promise.all([renderSidebar(), run()]);
  statusEl.textContent = skipped
    ? `Imported ${plural(merged, 'page')}. Skipped ${plural(skipped, 'unreadable line')}.`
    : `Imported ${plural(merged, 'page')}.`;
}

exportEl.addEventListener('click', exportArchive);

importEl.addEventListener('change', async () => {
  const [file] = importEl.files;
  if (!file) return;
  dialog.close();
  await importArchive(file);
  importEl.value = ''; // so picking the same file again still fires
});

// --- Keyboard ----------------------------------------------------------------

const inField = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');

document.addEventListener('keydown', (e) => {
  // Slash jumps to the search box from anywhere, unless you are already typing.
  if (e.key === '/' && !inField() && !dialog.open) {
    e.preventDefault();
    input.focus();
    input.select();
    return;
  }

  // Down and up move through the results. Enter opens the focused link natively.
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if (dialog.open) return;
  const links = [...list.querySelectorAll('.hit-title')];
  if (!links.length) return;
  e.preventDefault();

  const at = links.indexOf(document.activeElement);
  if (e.key === 'ArrowUp' && at <= 0) return input.focus();
  links[e.key === 'ArrowDown' ? Math.min(at + 1, links.length - 1) : at - 1].focus();
});

// --- Start -------------------------------------------------------------------

loadSettings();
renderSidebar().then(run);
