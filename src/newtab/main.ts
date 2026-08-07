/// <reference types="chrome" />

import * as db from "../shared/db";
import { render, renderClusters } from "./render";
import {
  clusterBookmarks,
  clusteringAlgorithms,
  type ClusteringAlgorithm,
} from "../indexing/clustering";

const bookmarkListEl = document.getElementById("bookmark-list")!;
const viewSelectorEl = document.getElementById("view-selector")!;
type View = "bookmarks" | ClusteringAlgorithm;
let selectedView: View = "bookmarks";

async function init() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log(`Received message`, message?.type ?? message);

    if (message.type === "hello") {
      sendResponse({ message: "hello" });
    } else if (message.type === "indexUpdated") {
      // NOTE: a better UX would be to replace this with a notification
      //   inviting user to refresh the view (if newtab page is not active)
      loadAndRender();
    }
  });

  // Render immediately with whatever is cached
  await loadAndRender();

  chrome.runtime.sendMessage({ type: "reconcileBookmarks" });
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

  if (selectedView === "bookmarks") {
    render(bookmarkListEl, roots, keywordsMap);
  } else {
    await renderSelectedClusters();
  }
}

function setupViewSelector() {
  addViewButton("bookmarks", "Bookmarks");
  for (const algorithm of clusteringAlgorithms) {
    addViewButton(algorithm.id, algorithm.label);
  }
}

function addViewButton(view: View, label: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.view = view;
  if (view === selectedView) button.classList.add("selected");
  button.addEventListener("click", async () => {
    selectedView = view;
    for (const item of viewSelectorEl.querySelectorAll("button")) {
      item.classList.toggle("selected", item.dataset.view === view);
    }
    if (view === "bookmarks") await loadAndRender();
    else await renderSelectedClusters();
  });
  viewSelectorEl.appendChild(button);
}

async function renderSelectedClusters() {
  if (selectedView === "bookmarks") return;
  bookmarkListEl.innerHTML =
    '<p class="cluster-summary">Clustering bookmarks…</p>';
  try {
    renderClusters(bookmarkListEl, await clusterBookmarks(selectedView));
  } catch (error) {
    console.error("[Pebble] Bookmark clustering failed", error);
    bookmarkListEl.innerHTML =
      '<p class="cluster-summary">Clustering failed. Check the console for details.</p>';
  }
}

setupViewSelector();
init();
