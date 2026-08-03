/// <reference types="chrome" />

import {
  checkAndRunIndex,
  handleBookmarkCreatedOrChanged,
  handleBookmarkRemoved,
} from "../indexing/indexer";

// Track pending event processing to keep the worker alive
let pendingWork = 0;

function keepAlive(): () => void {
  pendingWork++;
  return () => {
    pendingWork--;
  };
}

// Register listeners synchronously — no top-level await
chrome.bookmarks.onCreated.addListener((id) => {
  const done = keepAlive();
  handleBookmarkCreatedOrChanged(id).finally(done);
});

chrome.bookmarks.onChanged.addListener((id) => {
  const done = keepAlive();
  handleBookmarkCreatedOrChanged(id).finally(done);
});

chrome.bookmarks.onMoved.addListener((id) => {
  const done = keepAlive();
  handleBookmarkCreatedOrChanged(id).finally(done);
});

chrome.bookmarks.onRemoved.addListener((_id, removeInfo) => {
  const done = keepAlive();
  handleBookmarkRemoved(removeInfo.node).finally(done);
});

// Handle messages from the new-tab page
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "checkIndex") {
    checkAndRunIndex()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: String(err) });
      });
    return true; // async response
  }
});

// Run index check on worker startup
checkAndRunIndex();
