/// <reference types="chrome" />

import {
  reconcileBookmarks,
  handleBookmarkCreatedOrChanged,
  handleBookmarkRemoved,
} from "../indexing/indexer";

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "hello") {
    sendResponse({ message: "hello" });
  } else if (message.type === "checkIndex") {
    reconcileBookmarks()
      .then(() => sendResponse({ message: "ok" }))
      .catch((err) => sendResponse({ error: String(err) }));
    return true; // async response
  }
});

reconcileBookmarks();
