/// <reference types="chrome" />

import * as db from "../shared/db";
import { render, renderClusters } from "./render";
import {
  clusterBookmarks,
  clusteringAlgorithms,
  type ClusteringAlgorithm,
  type ClusteringResult,
} from "../indexing/clustering";
import {
  buildBookmarkGraph,
  renderForceGraph,
  type GraphNode,
} from "./forcegraph";

const bookmarkListEl = document.getElementById("bookmark-list")!;
const viewSelectorEl = document.getElementById("view-selector")!;

type View = "bookmarks" | ClusteringAlgorithm;
type ClusterDisplay = "cards" | "graph";

let selectedView: View = "bookmarks";
let clusterDisplay: ClusterDisplay = "cards";
let graphCleanup: (() => void) | null = null;

// Per-algorithm cached clustering results so toggling display is instant
const clusteringCache = new Map<ClusteringAlgorithm, ClusteringResult>();

async function init() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log(`Received message`, message?.type ?? message);

    if (message.type === "hello") {
      sendResponse({ message: "hello" });
    } else if (message.type === "indexUpdated") {
      // Clear cache so fresh data is used on next render
      clusteringCache.clear();
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

  // Clean up graph view when switching back to bookmarks
  if (graphCleanup) {
    graphCleanup();
    graphCleanup = null;
  }

  removeDisplayToggle();
  bookmarkListEl.classList.remove("clustering-active");

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
    clusterDisplay = "cards"; // reset to cards on algorithm change
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

  // Clean up any previous graph render
  if (graphCleanup) {
    graphCleanup();
    graphCleanup = null;
  }

  bookmarkListEl.innerHTML =
    '<p class="cluster-summary">Clustering bookmarks…</p>';

  try {
    const result = await clusterBookmarks(selectedView);
    clusteringCache.set(selectedView, result);
    renderDisplayToggle();
    renderCurrentDisplay(result);
  } catch (error) {
    console.error("[Pebble] Bookmark clustering failed", error);
    bookmarkListEl.innerHTML =
      '<p class="cluster-summary">Clustering failed. Check the console for details.</p>';
  }
}

/** Render the Cards / Graph toggle bar above the content. */
let toggleBar: HTMLElement | null = null;

function renderDisplayToggle() {
  removeDisplayToggle();

  bookmarkListEl.classList.add("clustering-active");

  toggleBar = document.createElement("div");
  toggleBar.className = "display-toggle";

  const cardsBtn = document.createElement("button");
  cardsBtn.type = "button";
  cardsBtn.textContent = "Cards";
  cardsBtn.dataset.mode = "cards";
  if (clusterDisplay === "cards") cardsBtn.classList.add("active");

  const graphBtn = document.createElement("button");
  graphBtn.type = "button";
  graphBtn.textContent = "Graph";
  graphBtn.dataset.mode = "graph";
  if (clusterDisplay === "graph") graphBtn.classList.add("active");

  cardsBtn.addEventListener("click", async () => {
    clusterDisplay = "cards";
    cardsBtn.classList.add("active");
    graphBtn.classList.remove("active");
    const cached = clusteringCache.get(selectedView as ClusteringAlgorithm);
    if (cached) renderCurrentDisplay(cached);
  });

  graphBtn.addEventListener("click", async () => {
    clusterDisplay = "graph";
    graphBtn.classList.add("active");
    cardsBtn.classList.remove("active");
    const cached = clusteringCache.get(selectedView as ClusteringAlgorithm);
    if (cached) renderCurrentDisplay(cached);
  });

  toggleBar.appendChild(cardsBtn);
  toggleBar.appendChild(graphBtn);
  bookmarkListEl.before(toggleBar);
}

function removeDisplayToggle() {
  if (toggleBar) {
    toggleBar.remove();
    toggleBar = null;
  }
}

function renderCurrentDisplay(result: ClusteringResult) {
  if (graphCleanup) {
    graphCleanup();
    graphCleanup = null;
  }

  if (clusterDisplay === "cards") {
    renderClusters(bookmarkListEl, result);
  } else {
    renderGraphView(result);
  }
}

async function renderGraphView(clustering: ClusteringResult) {
  bookmarkListEl.innerHTML =
    '<p class="cluster-summary">Building similarity graph…</p>';
  try {
    const graph = await buildBookmarkGraph(clustering);
    graphCleanup = renderForceGraph(
      bookmarkListEl,
      graph,
      (node: GraphNode) => {
        window.open(node.url, "_blank");
      },
    );
  } catch (error) {
    console.error("[Pebble] Force graph failed", error);
    bookmarkListEl.innerHTML =
      '<p class="cluster-summary">Graph rendering failed. Check the console for details.</p>';
  }
}

setupViewSelector();
init();
