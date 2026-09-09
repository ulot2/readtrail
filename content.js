// Extracts the readable article, but only after the page held your attention.
// Readability rewrites the document it is given, so it always gets a clone.

const DWELL_SECONDS = 5;
const MIN_CHARS = 500;

// An incognito window is meant to leave no trace, so nothing runs in one at all.
if (!chrome.extension.inIncognitoContext) start();

function start() {
  let seconds = 0;

  const timer = setInterval(async () => {
    if (document.visibilityState !== 'visible') return; // a background tab is not reading
    if (++seconds < DWELL_SECONDS) return;
    clearInterval(timer);

    if (await muted()) return;

    const page = extract();
    if (!page) return;
    chrome.runtime.sendMessage({ type: 'page', url: location.href, ...page }).catch(() => {});
  }, 1000);
}

// Read now rather than at page load, so pausing also stops tabs already open.
// Denylist entries are stored clean, which is why matching them is one comparison.
async function muted() {
  const { paused = false, denylist = [] } = await chrome.storage.local.get(['paused', 'denylist']);
  if (paused) return true;

  const here = location.hostname;
  return denylist.some((site) => here === site || here.endsWith(`.${site}`));
}

function extract() {
  // Never archive a sign-in, bank, or account page.
  if (document.querySelector('input[type="password"]')) return null;

  const article = new Readability(document.cloneNode(true)).parse();
  if (!article) return null; // not an article, so there is nothing worth keeping

  const text = article.textContent.trim().replace(/\n{3,}/g, '\n\n');
  if (text.length < MIN_CHARS) return null;

  return { title: article.title || document.title, text };
}
