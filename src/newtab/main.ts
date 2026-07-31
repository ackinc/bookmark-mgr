/// <reference types="chrome" />

import * as db from "./db";
import { extractKeywords } from "./keywords";
import { render } from "./render";

const bookmarkListEl = document.getElementById("bookmark-list")!;

async function init() {
  chrome.bookmarks.onCreated.addListener(handleBookmarkCreatedOrChanged);
  chrome.bookmarks.onChanged.addListener(handleBookmarkCreatedOrChanged);
  chrome.bookmarks.onMoved.addListener(handleBookmarkCreatedOrChanged);
  chrome.bookmarks.onRemoved.addListener(handleBookmarkRemoved);

  await loadAndRender();
}

async function loadAndRender() {
  const roots = await chrome.bookmarks.getTree();

  const keywordsMap = new Map<
    chrome.bookmarks.BookmarkTreeNode["id"],
    string[]
  >();
  const toUpsert: {
    node: chrome.bookmarks.BookmarkTreeNode;
    keywords: string[];
  }[] = [];

  async function collectNodes(node: chrome.bookmarks.BookmarkTreeNode) {
    if (node.url) {
      const stored = await db.getBookmark(node.id);

      if (
        stored &&
        stored.title === node.title &&
        stored.url === node.url &&
        stored.keywords.length > 0
      ) {
        // Use stored keywords — bookmark hasn't changed
        keywordsMap.set(node.id, stored.keywords);
      } else {
        // First encounter or title/url changed — extract and store
        const keywords = await extractKeywords(node);
        keywordsMap.set(node.id, keywords);
        toUpsert.push({ node, keywords });
      }
    }
    if (node.children) {
      await Promise.all(node.children.map(collectNodes));
    }
  }
  await Promise.all(roots.map(collectNodes));

  if (toUpsert.length > 0) {
    await db.upsertBookmarks(toUpsert);
  }

  render(bookmarkListEl, roots, keywordsMap);
}

async function handleBookmarkCreatedOrChanged(id: string) {
  const bookmark = (await chrome.bookmarks.get(id))[0];
  await helper(bookmark);
  await loadAndRender();

  async function helper(bookmark: chrome.bookmarks.BookmarkTreeNode) {
    if (bookmark.url) {
      await db.upsertBookmarks([
        { node: bookmark, keywords: await extractKeywords(bookmark) },
      ]);
    } else {
      await Promise.all((bookmark.children ?? []).map(helper));
    }
  }
}

async function handleBookmarkRemoved(
  _id: string,
  removeInfo: { node: chrome.bookmarks.BookmarkTreeNode },
) {
  const bookmark = removeInfo.node;
  await helper(bookmark);
  await loadAndRender();

  async function helper(bookmark: chrome.bookmarks.BookmarkTreeNode) {
    if (bookmark.url) {
      await db.removeBookmark(bookmark.id);
    } else {
      await Promise.all((bookmark.children ?? []).map(helper));
    }
  }
}

init();
