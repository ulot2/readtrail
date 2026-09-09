# Archive

A personal, offline archive of the pages you read. The text stays on your computer
in a SQLite database. Nothing is sent anywhere.

Status: day 13 of 14. Feature complete. What is left is the store listing, the
screen capture, and the Measurements table.

## Setup

Run these once:

```bash
npm install && npm run vendor
```

`npm run vendor` copies SQLite and Readability into `vendor/`. Manifest V3 forbids
remote code, so the extension loads both as local files. `vendor/` is not in git.

The icons are in git already. To change them, edit the numbers at the top of
`icons.mjs` and run `npm run icons`. It writes PNG with `node:zlib` alone,
because Chrome will not take an SVG and a design tool would leave four binary
files nobody can edit.

## Load the extension

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click "Load unpacked" and select this folder.
4. Pin the extension. Its toolbar button opens the search page.

After you edit any file, click the reload icon on the extension card. Then reload
the web pages you want to test, because a content script only runs on page load.

## What gets archived

A page is stored when all of these are true:

- The window is not incognito.
- Archiving is not paused.
- The site is not on your denylist.
- You kept the tab visible for 5 seconds.
- The page has no password field.
- Readability finds an article in it.
- That article holds at least 500 characters.

Everything else is dropped on purpose. Most of the web is not worth keeping.

The pause switch and the denylist live under "Manage" on the search page. While
archiving is paused, the toolbar button carries a red "off" badge, so a pause you
forgot about cannot quietly leave a hole in the archive.

## How search works

FTS5 does the work. The title carries ten times the weight of the body, and
`bm25()` ranks the results. `snippet()` returns the matching excerpt already cut
to size.

The query box never reaches SQLite as typed. FTS5 has its own grammar, so a
hyphen or an apostrophe would throw. `toMatch()` in `db-worker.js` quotes every
token and adds a prefix match to the last one, so results update as you type.

Excerpts arrive wrapped in two control characters instead of HTML tags. The page
escapes the whole string first and swaps those markers for `<mark>` after.
Archived page text therefore cannot inject markup into the results.

When a search finds fewer than ten pages, it tries again with related words. The
few pages it did find are the best guide to what you meant, so their most
distinctive words become a second search, and the two rankings merge by position
rather than by score. Distinctive means a word on few pages, measured against the
index itself, which is why no stopword list exists in this codebase. The status
line names every word that was added, so a surprising result stays explainable.

This needs no model and no download. The meaning it uses is already in your
archive. Its limit is honest: a word that appears nowhere in your pages stays
unfindable, because expansion needs at least one result to learn from.

## Day 7 check

1. Click the toolbar button. The search page must open with your recent pages
   listed and the box empty.
2. Type a word you remember from one article. Matching results must appear within
   a keystroke or two, with the word highlighted.
3. Type a word that is in a title. Make sure that page ranks near the top.
4. Type `don't` or `state-of-the-art`. Make sure that no error appears, because
   this is the escaping test.
5. Press the down arrow from the box. Focus must move into the results. Press
   Enter to open one.
6. Set the range to "Today". Make sure that older pages disappear.

## Files

| File | Job |
|---|---|
| `manifest.json` | Permissions, and the `wasm-unsafe-eval` rule that lets WebAssembly start |
| `content.js` | Runs inside the page. Waits for dwell time, then extracts the article |
| `sw.js` | Makes sure the offscreen document exists, then routes messages |
| `offscreen.html` / `offscreen.js` | A hidden page that owns the worker |
| `db-worker.js` | Schema, deduplication, search, and the only code that touches SQLite |
| `lib.js` / `lib.test.js` | URL cleaning and query escaping, plus the tests Node can run |
| `search.html` / `search.js` | The search page. No framework, on purpose |
| `vendor.mjs` | Copies dependencies into `vendor/` |
| `icons.mjs` | Draws the toolbar icons. No design tool, no dependency |
| `PRIVACY.md` | The privacy policy the store listing points at |

## Testing

```bash
npm test
```

That covers the two functions that can corrupt data without telling you. The rest
of the system needs a browser, so [TESTING.md](TESTING.md) holds the checklist.

## Your data

Everything lives in one SQLite file in the browser's private storage. "Export
archive" under Manage writes it out as NDJSON, which is one JSON object per line:

```json
{"url":"https://example.com/a","title":"A title","text":"...","first_at":1757000000000,"last_at":1757000000000,"visits":2}
```

There is no header and no wrapper, so `grep`, `split`, and `tail` all work on the
file directly. Import merges by address. A page you already have keeps its
earliest first visit and its highest visit count, and the newer copy wins on the
text. Importing the same file twice changes nothing.

## Measurements

Run layer 11 in [TESTING.md](TESTING.md), then replace these blanks. These
numbers are the reason a reader believes the rest of the file.

Machine: fill in. Chrome version: fill in.

| Pages | Database size | Median search | Browse |
|---|---|---|---|
| 5,000 | | | |
| 10,000 | | | |
| 15,000 | | | |
| 20,000 | | | |

## Next

Day 14: the store listing, a 30-second screen capture, and the Measurements table.

Neural embeddings were considered for day 13 and rejected on measurement.
Manifest V3 forbids remote code, so the inference engine has to ship inside the
extension: 12.3 MB of ONNX runtime plus 1.0 MB of library, on top of a 23 MB
model downloaded at run time. That turns a 2.8 MB extension into 16 MB for every
user, including everyone who never switches it on. Revisit it as version 0.2 if
related-word search proves too weak in daily use.
