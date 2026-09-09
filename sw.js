// The service worker owns one thing: making sure the offscreen document exists.
// It holds no state, because Chrome stops it whenever it is idle.

let creating = null;

async function ensureOffscreen() {
  if (creating) return creating;
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;

  creating = chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Runs the SQLite worker that stores the archive on disk.',
    })
    .catch((err) => {
      // Two calls raced. The other one won, which is the result we wanted.
      if (!String(err).includes('single offscreen')) throw err;
    })
    .finally(() => {
      creating = null;
    });

  return creating;
}

async function db(op, args = {}) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: 'offscreen', op, ...args });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'page') {
    db('save', msg).then((reply) =>
      reply.ok
        ? console.log('[archive] saved', reply.result.pages, '|', msg.title)
        : console.error('[archive] save failed', msg.url, reply.error)
    );
    return;
  }

  if (msg?.type === 'db') {
    db(msg.op, msg).then(sendResponse);
    return true; // the reply arrives later, so hold the channel open
  }
});

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: 'search.html' }));

// A pause you forget about is an archive with a hole in it, so the button says so.
function setBadge(paused) {
  chrome.action.setBadgeBackgroundColor({ color: '#b3261e' });
  chrome.action.setBadgeText({ text: paused ? 'off' : '' });
  chrome.action.setTitle({ title: paused ? 'Archive: paused' : 'Archive: search your pages' });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.paused) setBadge(changes.paused.newValue);
});

// The badge does not survive a browser restart, so it is written again on start.
const refreshBadge = async () => setBadge((await chrome.storage.local.get('paused')).paused);
chrome.runtime.onStartup.addListener(refreshBadge);

chrome.runtime.onInstalled.addListener(({ reason }) => {
  refreshBadge();
  // An archive that starts empty explains nothing, so show the page that does.
  if (reason === 'install') chrome.tabs.create({ url: 'search.html' });
});
