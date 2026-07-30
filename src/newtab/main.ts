/// <reference types="chrome" />

import {
  deleteBookmark,
  moveBookmark,
  createBookmark,
  subscribeToChanges,
} from "./bookmarks";
import { loadStoredData } from "./layout";
import { upsertBookmarks, removeBookmark } from "./db";
import { render, setExpandedFolders, type RenderCallbacks } from "./render";
import { extractKeywords } from "./keywords";

type BookmarkId = string;
const bookmarkListEl = document.getElementById("bookmark-list")!;
const toastEl = document.getElementById("toast")!;

let pendingDeletion: {
  node: chrome.bookmarks.BookmarkTreeNode;
  parentId: BookmarkId;
  timeoutId: number;
} | null = null;

async function init() {
  const stored = await loadStoredData();
  if (stored?.expandedFolders) {
    setExpandedFolders(stored.expandedFolders);
  }

  await loadAndRender();

  subscribeToChanges(() => {
    loadAndRender();
  });
}

async function loadAndRender() {
  const roots = await chrome.bookmarks.getTree();

  const nodes: chrome.bookmarks.BookmarkTreeNode[] = [];
  const keywordsMap = new Map<BookmarkId, string[]>();

  async function collectNodes(node: chrome.bookmarks.BookmarkTreeNode) {
    if (node.url) {
      nodes.push(node);
      keywordsMap.set(node.id, await extractKeywords(node));
    }
    if (node.children) {
      await Promise.all(node.children.map(collectNodes));
    }
  }
  await Promise.all(roots.map(collectNodes));
  await upsertBookmarks(
    nodes.map((node) => ({ node, keywords: keywordsMap.get(node.id)! })),
  );

  const callbacks: RenderCallbacks = {
    onNodeClick: handleNodeClick,
    onNodeDelete: handleNodeDelete,
    onBookmarkMove: handleBookmarkMove,
  };

  render(bookmarkListEl, roots, callbacks, keywordsMap);
}

function handleNodeClick(node: chrome.bookmarks.BookmarkTreeNode) {
  if (node.url) {
    window.open(node.url, "_blank");
  }
}

async function handleNodeDelete(node: chrome.bookmarks.BookmarkTreeNode) {
  if (pendingDeletion) {
    clearTimeout(pendingDeletion.timeoutId);
    pendingDeletion = null;
  }

  const parentId = node.parentId!;
  await removeBookmark(node.id);
  await deleteBookmark(node.id);

  showToast(
    `Deleted "${(node.title || node.url || "").slice(0, 30)}". `,
    async () => {
      if (pendingDeletion) {
        clearTimeout(pendingDeletion.timeoutId);
      }
      try {
        const restored = await createBookmark(
          node.url!,
          node.title || "",
          parentId,
        );
        const keywords = await extractKeywords(restored);
        await upsertBookmarks([{ node: restored, keywords }]);
        pendingDeletion = null;
        await loadAndRender();
      } catch {
        showToast("Failed to restore bookmark.");
      }
    },
  );
}

async function handleBookmarkMove(bookmarkId: string, newParentId: string) {
  await moveBookmark(bookmarkId, newParentId);
  await loadAndRender();
}

function showToast(message: string, onUndo?: () => void) {
  toastEl.innerHTML = message;
  if (onUndo) {
    const undoBtn = document.createElement("button");
    undoBtn.textContent = "Undo";
    undoBtn.addEventListener("click", () => {
      onUndo();
      toastEl.classList.add("hidden");
    });
    toastEl.appendChild(undoBtn);
  }
  toastEl.classList.remove("hidden");

  setTimeout(() => {
    toastEl.classList.add("hidden");
  }, 4000);
}

init();
