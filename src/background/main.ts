/// <reference types="chrome" />

import {
  checkAndRunIndex,
  handleBookmarkCreatedOrChanged,
  handleBookmarkRemoved,
} from "../indexing/indexer";

// Register listeners synchronously — no top-level await
chrome.bookmarks.onCreated.addListener((id) => {
  handleBookmarkCreatedOrChanged(id);
});

chrome.bookmarks.onChanged.addListener((id) => {
  handleBookmarkCreatedOrChanged(id);
});

chrome.bookmarks.onMoved.addListener((id) => {
  handleBookmarkCreatedOrChanged(id);
});

chrome.bookmarks.onRemoved.addListener((_id, removeInfo) => {
  handleBookmarkRemoved(removeInfo.node);
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
