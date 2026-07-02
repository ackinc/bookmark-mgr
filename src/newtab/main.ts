/// <reference types="chrome" />

import { deleteBookmark, createBookmark, subscribeToChanges } from "./bookmarks";
import { loadStoredData } from "./layout";
import { render, setExpandedFolders, type RenderCallbacks } from "./render";

const bookmarkListEl = document.getElementById("bookmark-list")!;
const toastEl = document.getElementById("toast")!;

let pendingDeletion: {
  node: chrome.bookmarks.BookmarkTreeNode;
  parentId: string;
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
  const tree = await chrome.bookmarks.getTree();

  const callbacks: RenderCallbacks = {
    onNodeClick: handleNodeClick,
    onNodeDelete: handleNodeDelete,
  };

  render(bookmarkListEl, tree, callbacks);
}

function handleNodeClick(node: chrome.bookmarks.BookmarkTreeNode) {
  if (node.url) {
    window.location.href = node.url;
  }
}

async function handleNodeDelete(node: chrome.bookmarks.BookmarkTreeNode) {
  if (pendingDeletion) {
    clearTimeout(pendingDeletion.timeoutId);
    pendingDeletion = null;
  }

  const parentId = node.parentId!;
  await deleteBookmark(node.id);

  showToast(`Deleted "${(node.title || node.url || "").slice(0, 30)}". `, async () => {
    if (pendingDeletion) {
      clearTimeout(pendingDeletion.timeoutId);
    }
    try {
      await createBookmark(node.url!, node.title || "", parentId);
      pendingDeletion = null;
      await loadAndRender();
    } catch {
      showToast("Failed to restore bookmark.");
    }
  });
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
