/// <reference types="chrome" />

import * as db from "../shared/db";
import { render } from "./render";

const bookmarkListEl = document.getElementById("bookmark-list")!;

async function init() {
  // Listen for index updates from the service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "indexUpdated") {
      // NOTE: a better UX would be to replace this with a notification
      //   inviting user to refresh the view (if newtab page is not active)
      loadAndRender();
    }
  });

  // Render immediately with whatever is cached
  await loadAndRender();

  // Request the service worker to check/run indexing (non-blocking)
  chrome.runtime.sendMessage({ type: "checkIndex" });
}

async function loadAndRender() {
  const roots = await chrome.bookmarks.getTree();

  const keywordsMap = new Map<
    chrome.bookmarks.BookmarkTreeNode["id"],
    string[]
  >();

  async function collectNodes(node: chrome.bookmarks.BookmarkTreeNode) {
    if (node.url) {
      const stored = await db.getBookmark(node.id);
      if (stored && stored.keywords.length > 0) {
        keywordsMap.set(node.id, stored.keywords);
      }
    }
    if (node.children) {
      await Promise.all(node.children.map(collectNodes));
    }
  }
  await Promise.all(roots.map(collectNodes));

  render(bookmarkListEl, roots, keywordsMap);
}

init();
