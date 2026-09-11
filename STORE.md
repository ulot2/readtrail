# Chrome Web Store listing

Everything the developer dashboard asks for, in the order it asks. Copy each
block as it is. The wording is deliberately plain, because a reviewer reads
hundreds of these and a listing that overclaims gets a closer look.

## Before you submit

Do these in this order. Each one depends on the one before it.

1. Make the GitHub repository public. The privacy policy link below must open
   for a reviewer who is not signed in.
2. Run the manual checks in `TESTING.md` one last time on the build you will
   upload.
3. Build the package:

```bash
npm run pack
```

That writes `archive-0.1.0.zip` with `manifest.json` at its root, which is what
the store requires. It leaves out tests, tooling, and documentation.

4. Register as a developer at the Chrome Web Store developer dashboard if you
   have not. There is a one-time fee.

## Store listing

### Name

The store shows the `name` from `manifest.json`, which is `Archive`. That is a
common word, so it is hard to find by search. If you want the listing to be
findable, change the manifest name before you build the package. Suggested:

```
Archive: search everything you read
```

That is 35 characters. The limit is 45.

### Summary

The limit is 132 characters. This is 118.

```
Keeps the text of every article you read and lets you search it later. Stored on your computer only. Nothing is sent anywhere.
```

### Description

```
Archive remembers what you read so you do not have to.

When you spend more than five seconds on an article, Archive saves its text. Later, when you half-remember something you read last month, you search for it and it is there. The search works while you type, ranks results, and shows you the matching passage.

Everything stays on your computer. Archive has no server, no account, and makes no network requests. The text lives in a database inside your browser. You can export the whole archive as a plain text file at any time, and you can delete any page, any site, or everything older than a date you choose.

What it saves:
- Articles you kept visible for at least five seconds
- The readable text only. No images, no scripts, no page layout

What it never saves:
- Anything in an incognito window
- Any page with a password field, such as a bank or a sign-in page
- Any site you put on your denylist
- Anything while archiving is paused

Search:
- Results appear as you type, with the matching words highlighted
- Filter by site or by date
- When a search finds almost nothing, Archive tries again with related words drawn from your own pages, and tells you which words it added

Your data:
- Export everything as one file, one page per line
- Import that file into another browser. Import merges and never overwrites newer reading
- Delete a page, a whole site, or every page older than 30 days, 90 days, or a year

Archive is open source. The code, the tests, and the privacy policy are at https://github.com/ulot2/personal-web-archive
```

### Category

Productivity

### Language

English

## Graphic assets

The store needs at least one screenshot at 1280 by 800. Take these five, in
this order, with a real archive of a few dozen pages so the sidebar has
something in it.

1. The main view. A search typed in, results with highlighted words, the
   sidebar showing sites and counts.
2. A site filter active. One site selected in the sidebar, the "in site" chip
   under the search box, results narrowed.
3. Related words. A search that returned few results, with the "Also searched"
   chips visible.
4. The settings dialog open, showing the denylist and the export button.
5. The empty state on a fresh install, so a reader sees what it does before
   it has done anything.

Icon: `icons/icon-128.png`. The store takes it from the package.

Small promo tile, 440 by 280, is optional. Skip it for the first submission.

## Privacy tab

The dashboard asks these questions on its own tab. Answer exactly this.

### Single purpose

```
Saves the text of articles the user reads and lets the user search that text later, entirely on the user's own computer.
```

### Permission justifications

The dashboard shows one box per permission.

Host permissions, all sites:

```
Archive reads the article text of pages the user reads, on whichever site they are reading. It cannot know in advance which sites those will be. The text is stored locally and never transmitted. Pages with a password field, incognito windows, and any site on the user's denylist are skipped.
```

storage:

```
Stores two user settings: whether archiving is paused, and the list of sites the user has chosen never to archive.
```

offscreen:

```
Runs the SQLite database in a worker owned by an offscreen document, because the extension service worker is stopped when idle and a stopped worker must never interrupt a database write.
```

favicon:

```
Shows each site's icon next to search results, from Chrome's own local icon cache. This causes no network request.
```

### Remote code

Select "No, I am not using remote code." Every script, including the database
engine, is inside the package.

### Data usage

Under "What user data do you plan to collect", tick nothing. Archive collects
nothing. Then certify all three statements: no sale of data, no use unrelated
to the single purpose, no use for creditworthiness or lending.

### Privacy policy URL

```
https://github.com/ulot2/personal-web-archive/blob/main/PRIVACY.md
```

## Distribution

Visibility: Public.

Regions: all.

## After you submit

Review takes from a day to about a week. Broad host permissions get a closer
look, which is why every justification above explains the permission rather
than asserting the need for it.

If the reviewer asks a question, answer it with the same plain sentences. If
they reject, the reason arrives by email. Read it twice, fix exactly that, and
resubmit. Do not rewrite the listing in response to one rejection.

## The 30-second capture

Record at 1280 by 800, no narration, no music. Cursor movements slow enough to
follow. Put the finished file at the top of the README.

| Seconds | What is on screen |
|---|---|
| 0 to 3 | The search page. Empty box, sidebar with sites and counts. |
| 3 to 8 | Type a word you know is in there. Results appear as you type. Words are highlighted. |
| 8 to 13 | Click a site in the sidebar. Results narrow, the chip appears. Click the chip's cross. |
| 13 to 18 | Type a rarer word. "Also searched" chips appear. Click one. Results change. |
| 18 to 22 | Open Settings. Show the denylist and the export button. Close it. |
| 22 to 27 | Switch to another tab with an article. Wait five seconds. Switch back. It is now at the top of the list. |
| 27 to 30 | Rest on the search box, sidebar count visible. End. |

The 22-to-27 segment is the one that sells it. It shows the whole loop, read
then find, in five seconds with no explanation.
