# Testing

Two layers. Node tests cover the logic that can quietly corrupt data. The
checklist covers the browser behaviour, which no test runner can reach.

## Layer 1: automated

```bash
npm test
```

This runs `lib.test.js` against `lib.js`. It covers URL normalization and the
FTS5 query escaping. Those two functions decide whether you get duplicate rows
and whether a search throws.

It does not cover Chrome, SQLite, or the message flow. Nothing here replaces the
checklist below.

## Layer 2: before every manual run

1. Open `chrome://extensions` and click the reload icon on the extension card.
2. Look at the card for a red "Errors" button. If it is there, read it first.
3. Reload any web page you plan to test, because a content script only runs on page load.

You need three different consoles, and each one shows different messages:

| Console | How to open it | What appears there |
|---|---|---|
| Service worker | Click "service worker" on the extension card | `[archive] saved` lines and save failures |
| Web page | Press F12 on the article itself | Errors thrown inside `content.js` |
| Search page | Press F12 on the search tab | Errors thrown inside `search.js` |

## Layer 3: capture rules

Each row is one test. Wait ten seconds unless the row says otherwise.

| Test | Do this | Expect |
|---|---|---|
| Dwell | Open a long article. Close the tab after 2 seconds | No save |
| Background tab | Open an article with ctrl-click. Never look at it | No save, even after a minute |
| Password page | Open any sign-in page | No save |
| Not an article | Open a site home page or a search results page | No save |
| Too short | Open a very short page | No save |
| Happy path | Read a long article | `[archive] saved` and a rising count |

The background tab test is the important one. It proves the timer counts visible
seconds and not wall-clock seconds.

## Layer 4: storage rules

1. Archive an article. Note the page count.
2. Open the same article again with `?utm_source=test` added to the address.
3. Make sure that the count does not rise.
4. Open the search page and find that article. Its line must say "2 visits".
5. Open the same article again with `www.` added or removed.
6. Make sure that the count still does not rise.
7. Quit Chrome completely. Start it again. Open the search page.
8. Make sure that every page is still there.

Step 7 is the storage test. If the list is empty, OPFS did not persist.

To test that an edited page updates its stored text, serve a file you control:

```bash
npx --yes serve
```

Put a long article in an HTML file, read it, edit the file, then read it again.
The stored text must change and the count must stay the same.

## Layer 5: search

| Test | Do this | Expect |
|---|---|---|
| Browse | Open the search page with an empty box | Recent pages listed |
| Body match | Type a word from inside one article | That article appears, word highlighted |
| Title weight | Type a word from a title | That page ranks near the top |
| Prefix | Type the first four letters of a word | Results appear before you finish typing |
| Escaping | Type `don't` then `state-of-the-art` then `say "hi"` | Results or "Nothing matches", never an error |
| Date filter | Set the range to "Today" | Older pages disappear |
| Keyboard | Press down arrow from the box | Focus enters the results. Enter opens one |
| Empty result | Type a nonsense word | "Nothing matches." |

## Layer 6: the architecture test

This is the test that proves the design, so do not skip it. Chrome stops the
service worker when it is idle, and the archive has to survive that.

1. Open the search page and run one search.
2. Go to `chrome://extensions` and watch the card.
3. Wait until the link says "service worker (Inactive)". This takes about 30 seconds.
4. Return to the search page and search again.
5. Make sure that results still appear.

If step 5 fails, the service worker lost something it was holding, and it must
hold nothing.

Then test a cold start:

1. Reload the extension card. This destroys the service worker and the hidden page.
2. Open the search page straight away, without visiting any website first.
3. Make sure that results appear.

This proves `ensureOffscreen()` rebuilds the hidden page on demand.

## Layer 7: safety

1. Archive an article that quotes HTML, such as a tutorial about tags.
2. Search for a word next to that quoted HTML.
3. Make sure that the tags appear as visible text in the excerpt.
4. Make sure that no dialog opens and the search page console stays clean.

This proves the page escapes archived text before it adds the highlight.

## Layer 8: error paths

Open the search page console and run this:

```js
chrome.runtime.sendMessage({ type: 'db', op: 'nope' })
```

The reply must be `{ ok: false, error: 'unknown op: nope' }`. That proves an
error inside the worker travels back instead of disappearing.

## Layer 9: deletion

Deletion is permanent. Test it with pages you are willing to lose.

1. Archive three pages from one site, and one page from a different site.
2. Search for a word that appears in only one of them. Note the result.
3. Click "Delete page" on that result and confirm.
4. Make sure that the status line says "Deleted 1 page."
5. Search for that same word again. Make sure that nothing matches.

Step 5 is the index test. Removing the row is the easy half. The search index has
to lose the words too, and the delete trigger in the schema is what does that.

Then test the two bulk paths:

1. Click "Delete site" on any result and confirm.
2. Make sure that every page from that site is gone, and other sites are untouched.
3. Open "Manage", pick a range that covers nothing, and click Delete.
4. Make sure that the status line says "Deleted 0 pages."
5. Start any delete again, then cancel the dialog. Make sure that nothing is deleted.
6. Quit Chrome and start it again. Make sure that the deleted pages stayed deleted.

## Layer 10: privacy switches

Test the pause switch:

1. Open the search page, open "Manage", and tick "Pause archiving".
2. Make sure that a red "off" badge appears on the toolbar button.
3. Read a long article for fifteen seconds. Make sure that nothing is saved.
4. Untick the box. Make sure that the badge disappears.
5. Read another article. Make sure that it saves again.

Then test that pausing also stops a tab that was already open:

1. Open a long article, then switch away from it within two seconds.
2. Pause archiving from the search page.
3. Go back to the article and wait ten seconds.
4. Make sure that nothing is saved.

That works because the timer counts visible seconds. The article never reached
five seconds before you paused.

Test the denylist:

1. In "Manage", type `https://www.wikipedia.org/wiki/Test` into the box.
2. Click outside the box. Make sure that it now reads `wikipedia.org` alone.
3. Read a long Wikipedia article. Make sure that nothing is saved.
4. Read an article on `en.wikipedia.org`. Make sure that nothing is saved either.
5. Empty the box, click outside, and read again. Make sure that it saves.

Step 4 is the subdomain rule. Blocking a site blocks everything under it.

Test incognito:

1. On `chrome://extensions`, open Details and turn on "Allow in incognito".
2. Open an incognito window and read a long article.
3. Make sure that nothing is saved.

Step 1 matters. Without it the test proves nothing, because Chrome already keeps
the extension out of incognito windows.

## Layer 11: the scale test

This answers one question. Does search stay fast at 20,000 pages?

Seeding writes synthetic pages into your real archive. Every seeded row carries a
marker, and `unseed` removes exactly those rows. Your own pages are not touched.

1. Open the search page and press F12.
2. Run this in the console. It takes a few minutes.

```js
const runs = [];
for (let i = 0; i < 4; i++) {
  const reply = await chrome.runtime.sendMessage({ type: 'db', op: 'bench', count: 5000 });
  if (!reply.ok) throw new Error(reply.error);
  runs.push(reply.result);
}
console.table(runs.map(({ pages, megabytes, seedSeconds, pagesPerSecond }) =>
  ({ pages, megabytes, seedSeconds, pagesPerSecond })));
runs.forEach((r) => console.table(r.queries));
```

The archive grows in four steps and every step is measured. That gives you search
latency at roughly 5,000, then 10,000, then 15,000, then 20,000 pages.

3. Copy both tables into the Measurements section of the README.
4. Use the search page by hand at 20,000 pages. Typing must still feel instant.
5. Remove the seeded pages:

```js
await chrome.runtime.sendMessage({ type: 'db', op: 'unseed' })
```

6. Make sure that every page of your own is still there.

What the numbers mean:

| Number | Healthy | Act when |
|---|---|---|
| Median search time | under 20 ms | over 100 ms |
| Browse time | under 10 ms | over 50 ms |
| Megabytes per 1,000 pages | 2 to 5 | far above 10 |

If a query drags, look at the ranking first. FTS5 scores every matching row
before `LIMIT` cuts the list, so a word on every page costs the most.

### Writing the numbers down

The console gives you one summary table, then one query table per size. Paste
this block into the Measurements section of the README and fill it in.

```markdown
Machine: processor and memory. Chrome version: from `chrome://version`.

| Pages | Database size | Median search | Browse |
|---|---|---|---|
| 5,000 | | | |
| 10,000 | | | |
| 15,000 | | | |
| 20,000 | | | |

Median search is the `t0` query, a word on nearly every page. It is the slowest
case, not the typical one.
```

Every column comes from one place:

| Column | Where it comes from |
|---|---|
| Pages | `pages`, in the summary table |
| Database size | `megabytes`, in the summary table |
| Median search | `medianMs` on the `t0` row of that size's query table |
| Browse | `medianMs` on the `(browse)` row of that size's query table |

## Layer 12: export and import

Test the file itself:

1. Open "Manage" and click "Export archive".
2. Make sure that a file named `archive-<date>.ndjson` downloads.
3. Open it in a text editor. Every line must be one JSON object with a url, a
   title, and text.
4. Count the lines. The count must match the page count on the search page.

Test the round trip:

1. Note the page count.
2. Delete one page you can name.
3. Import the file you just exported.
4. Make sure that the deleted page returns and the count is what it was.
5. Import the same file again.
6. Make sure that the count does not move, because import merges by address.

Test that an older file cannot undo newer reading:

1. Export the archive.
2. Read one archived article twice more, so its visit count rises.
3. Import the file from step 1.
4. Make sure that the visit count did not go back down.

Test that a damaged file cannot damage the archive:

1. Copy the export file. In the copy, break three lines. Delete a brace from one.
   Change the url of another to `javascript:alert(1)`. Replace a third with plain text.
2. Import the copy.
3. Make sure that the status line reports three skipped unreadable lines.
4. Make sure that every good page still imported.
5. Import an unrelated file, such as a picture. Make sure that nothing imports and
   nothing breaks.

Step 5 is the trust boundary. An import file comes from outside, so no line is
believed until it passes `parseRow` in `lib.js`.

## Layer 13: related words

Expansion runs only when a search nearly missed. That condition is most of the
test.

1. Search a common word that matches many pages. Make sure that the status line
   does **not** say "Also searched", because a working search is left alone.
2. Search a rare word that matches one or two pages. Make sure that the status
   line names the related words it added.
3. Read those added words. They must belong to the same subject as the pages you
   found. Random words mean the weighting is wrong.
4. Read the extra results. They must be about the same topic, not noise.
5. Search a word that appears nowhere in your archive. Make sure that you get
   "Nothing matches." with no related words.

Step 5 is the honest limit, not a bug. Expansion learns from the results you did
get, so with no results there is nothing to learn from.

A good archive to test against needs a few dozen articles across two or three
subjects. With ten pages the statistics have nothing to say.

## Not tested yet

Everything built is covered above. Day 14 adds the store listing, which is
checked by submitting it.
