/// <reference types="chrome" />

import {
  getAllBookmarks,
  type BookmarkNode,
  moveBookmark,
  deleteBookmark,
  createBookmark,
  subscribeToChanges,
} from "./bookmarks";
import {
  computeLayout,
  loadStoredData,
  saveCanvasState,
  saveNodePositions,
  needsFullRelayout,
  type NodePositions,
  type CanvasState,
} from "./layout";
import {
  createCanvasController,
  type ViewportTransform,
  transformToCanvas,
} from "./canvas";
import {
  render,
  updateNodePosition,
  highlightFolderCircle,
  dimOriginCircle,
  findFolderAtPosition,
  removeNodeFromDOM,
  addNodeToDOM,
} from "./render";

const canvasContainer = document.getElementById("canvas-container")!;
const svgLayer = document.getElementById(
  "svg-layer",
)! as unknown as SVGSVGElement;
const htmlLayer = document.getElementById("html-layer")!;
const resetViewBtn = document.getElementById("reset-view")!;
const toastEl = document.getElementById("toast")!;

let allNodes: BookmarkNode[] = [];
let allFolders: import("./bookmarks").BookmarkFolder[] = [];
let positions: NodePositions = {};
let currentTransform: ViewportTransform = { panX: 0, panY: 0, zoom: 1 };

const canvasController = createCanvasController(
  canvasContainer,
  (transform) => {
    currentTransform = transform;
    saveCanvasState(transform);
  },
);

async function init() {
  const stored = await loadStoredData();

  if (stored?.canvas) {
    canvasController.setTransform(stored.canvas);
  }

  await loadAndRender(
    stored ? !needsFullRelayout(stored) : false,
    stored?.nodePositions || null,
  );

  subscribeToChanges(() => {
    loadAndRender(false, positions);
  });

  resetViewBtn.addEventListener("click", resetView);
}

async function loadAndRender(
  useExistingPositions: boolean,
  existingPositions: NodePositions | null,
) {
  const data = await getAllBookmarks();
  allNodes = data.nodes;
  allFolders = data.folders;

  if (
    useExistingPositions &&
    existingPositions &&
    Object.keys(existingPositions).length > 0
  ) {
    positions = existingPositions;
  } else {
    positions = computeLayout(allNodes, allFolders, existingPositions);
    await saveNodePositions(positions);
  }

  render(svgLayer, htmlLayer, allNodes, allFolders, positions, {
    onNodeClick: handleNodeClick,
    onNodeDelete: handleNodeDelete,
    onNodeDragStart: handleNodeDragStart,
  });
}

function handleNodeClick(node: BookmarkNode) {
  window.location.href = node.url;
}

let pendingDeletion: {
  node: BookmarkNode;
  parentId: string;
  timeoutId: number;
} | null = null;

async function handleNodeDelete(node: BookmarkNode) {
  if (pendingDeletion) {
    clearTimeout(pendingDeletion.timeoutId);
    pendingDeletion = null;
  }

  const parentId = node.parentId!;
  await deleteBookmark(node.id);
  removeNodeFromDOM(htmlLayer, node.id);

  delete positions[node.id];
  await saveNodePositions(positions);

  showToast(`Deleted "${node.title.slice(0, 30)}". `, async () => {
    if (pendingDeletion) {
      clearTimeout(pendingDeletion.timeoutId);
    }
    try {
      await createBookmark(node.url, node.title, parentId);
      pendingDeletion = null;
      await loadAndRender(false, positions);
    } catch {
      showToast("Failed to restore bookmark.");
    }
  });
}

function handleNodeDragStart(node: BookmarkNode, e: MouseEvent) {
  const containerRect = canvasContainer.getBoundingClientRect();
  const originFolder = allFolders.find((f) => f.id === node.parentId);

  let lastHighlightFolder: string | null = null;

  const onMouseMove = (moveEvent: MouseEvent) => {
    const canvasPos = transformToCanvas(
      moveEvent.clientX,
      moveEvent.clientY,
      currentTransform,
      containerRect,
    );

    updateNodePosition(htmlLayer, node.id, canvasPos);

    const hoveredFolder = findFolderAtPosition(
      allFolders,
      positions,
      canvasPos.x,
      canvasPos.y,
    );
    const hoveredFolderId = hoveredFolder?.id || null;

    if (hoveredFolderId !== lastHighlightFolder) {
      highlightFolderCircle(svgLayer, hoveredFolderId);
      if (originFolder && hoveredFolderId !== originFolder.id) {
        dimOriginCircle(svgLayer, originFolder.id);
      } else if (originFolder) {
        highlightFolderCircle(svgLayer, null);
      }
      lastHighlightFolder = hoveredFolderId;
    }
  };

  const onMouseUp = async (upEvent: MouseEvent) => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);

    highlightFolderCircle(svgLayer, null);

    const canvasPos = transformToCanvas(
      upEvent.clientX,
      upEvent.clientY,
      currentTransform,
      containerRect,
    );

    const targetFolder = findFolderAtPosition(
      allFolders,
      positions,
      canvasPos.x,
      canvasPos.y,
    );

    if (targetFolder && targetFolder.id !== node.parentId) {
      try {
        await moveBookmark(node.id, targetFolder.id);
        positions[node.id] = { x: canvasPos.x, y: canvasPos.y };
        await saveNodePositions(positions);
        await loadAndRender(false, positions);
      } catch (err) {
        console.error("Failed to move bookmark:", err);
      }
    } else if (!targetFolder) {
      const otherBookmarks = allFolders.find(
        (f) => f.title === "Other Bookmarks",
      );
      if (otherBookmarks && otherBookmarks.id !== node.parentId) {
        try {
          await moveBookmark(node.id, otherBookmarks.id);
          positions[node.id] = { x: canvasPos.x, y: canvasPos.y };
          await saveNodePositions(positions);
          await loadAndRender(false, positions);
        } catch (err) {
          console.error("Failed to move bookmark:", err);
        }
      }
    }
  };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
}

function resetView() {
  if (allNodes.length === 0) {
    canvasController.setTransform({
      panX: window.innerWidth / 2,
      panY: window.innerHeight / 2,
      zoom: 1,
    });
    return;
  }

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const pos of Object.values(positions)) {
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
    if (pos.x > maxX) maxX = pos.x;
    if (pos.y > maxY) maxY = pos.y;
  }

  const width = maxX - minX + 200;
  const height = maxY - minY + 200;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  canvasController.fitView(width, height, centerX, centerY);
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
