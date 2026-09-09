// A hidden page whose only job is to own the database worker and relay messages.
// A worker is required because OPFS synchronous file handles do not exist on a
// document thread.

const worker = new Worker('db-worker.js', { type: 'module' });
const pending = new Map();
let nextId = 1;
let fatal = null;

// The benchmark seeds 5,000 pages in a single call, and unseed vacuums a file
// that can reach 280 MB. This is long enough never to fire during real work, and
// short enough that a lost reply becomes a message instead of a hang.
const PATIENCE_MS = 300000;

// A module worker that fails to load says nothing at all. Without this handler
// every later request waits forever for a reply that can never arrive, which
// surfaces as a closed message channel and points at the wrong file.
worker.onerror = (event) => {
  fatal = event.message || 'the database worker failed to start';
  for (const settle of pending.values()) settle({ ok: false, error: fatal });
  pending.clear();
};

worker.onmessage = (event) => {
  const { id, ...reply } = event.data;
  pending.get(id)?.(reply);
};

function ask(message) {
  if (fatal) return Promise.resolve({ ok: false, error: fatal });

  return new Promise((resolve) => {
    const id = nextId++;

    const settle = (reply) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(reply);
    };

    const timer = setTimeout(
      () => settle({ ok: false, error: `the database did not answer in ${PATIENCE_MS / 1000}s` }),
      PATIENCE_MS
    );

    pending.set(id, settle);
    worker.postMessage({ id, ...message });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  ask(msg).then(sendResponse);
  return true; // keep the channel open for the async reply
});
