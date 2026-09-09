// A hidden page whose only job is to own the database worker and relay messages.
// A worker is required because OPFS synchronous file handles do not exist on a
// document thread.

const worker = new Worker('db-worker.js', { type: 'module' });
const pending = new Map();
let nextId = 1;

worker.onmessage = (e) => {
  const { id, ...reply } = e.data;
  const resolve = pending.get(id);
  if (!resolve) return;
  pending.delete(id);
  resolve(reply);
};

function ask(message) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    worker.postMessage({ id, ...message });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  ask(msg).then(sendResponse);
  return true; // keep the channel open for the async reply
});
