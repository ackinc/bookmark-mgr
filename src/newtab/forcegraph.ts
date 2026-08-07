/// <reference types="chrome" />

import * as db from "../shared/db";
import type { ClusteringResult } from "../indexing/clustering";

// d3-force submodules
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
} from "d3-force";
import { zoom } from "d3-zoom";
import { select } from "d3-selection";

// ── Types ────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  title: string;
  url: string;
  cluster: number; // -1 for noise/unclustered
  wordScores: Record<string, number>;
  // d3-force attaches these at runtime
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  index?: number;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  similarity: number;
}

/** Extract the node ID from an edge's source or target (string or node object). */
function edgeNodeId(value: string | GraphNode): string {
  return typeof value === "string" ? value : value.id;
}

export interface BookmarkGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusterLabels: string[]; // e.g. ["Cluster 1", "Cluster 2", "Unclustered"]
  clusterColors: Map<number, string>;
  summary: { nodeCount: number; edgeCount: number; clusterCount: number };
}

// ── Configuration ────────────────────────────────────────────────────────────

const K_NEIGHBORS = 6;
const SIMILARITY_THRESHOLD = 0.25;
const NODE_RADIUS = 5;
const HIGHLIGHT_RADIUS = 8;
const MAX_SIMULATION_TICKS = 300;
const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 0.0228;

// Deterministic color palette for clusters
const CLUSTER_PALETTE = [
  "#5f5fff",
  "#ff5f5f",
  "#5fff5f",
  "#ffaf5f",
  "#5fafff",
  "#ff5fff",
  "#5fffff",
  "#ffff5f",
  "#af5fff",
  "#ff5faf",
];
const NOISE_COLOR = "#999999";

// ── Public API ───────────────────────────────────────────────────────────────

/** Build the full graph data structure from indexed bookmarks. */
export async function buildBookmarkGraph(
  clustering?: ClusteringResult,
): Promise<BookmarkGraph> {
  const allBookmarks = await db.getAllBookmarks();
  const usable = allBookmarks.filter(
    (bm) => bm.url && hasUsableScores(bm.wordScores),
  );

  if (usable.length < 2) {
    return {
      nodes: [],
      edges: [],
      clusterLabels: [],
      clusterColors: new Map(),
      summary: { nodeCount: 0, edgeCount: 0, clusterCount: 0 },
    };
  }

  const vocabulary = [
    ...new Set(usable.flatMap((bm) => Object.keys(bm.wordScores))),
  ].sort();

  const vectors = usable.map((bm) =>
    normalize(vocabulary.map((term) => bm.wordScores[term] ?? 0)),
  );

  // Build cluster lookup
  const clusterLookup = buildClusterLookup(clustering);

  // Build nodes
  const nodes: GraphNode[] = usable.map((bm) => ({
    id: bm.id,
    title: bm.title,
    url: bm.url,
    cluster: clusterLookup.get(bm.id) ?? -1,
    wordScores: bm.wordScores,
  }));

  // Build sparse k-NN edges
  const edges = buildKnnEdges(
    vectors,
    nodes,
    K_NEIGHBORS,
    SIMILARITY_THRESHOLD,
  );

  // Build cluster metadata
  const clusterCounts = new Map<number, number>();
  for (const node of nodes) {
    clusterCounts.set(node.cluster, (clusterCounts.get(node.cluster) ?? 0) + 1);
  }

  const clusterLabels: string[] = [];
  const clusterColors = new Map<number, string>();
  let colorIndex = 0;

  // Named clusters first (non-negative), then noise
  const sortedClusters = [...clusterCounts.keys()].sort((a, b) => {
    if (a < 0 && b >= 0) return 1;
    if (a >= 0 && b < 0) return -1;
    return a - b;
  });

  for (const cluster of sortedClusters) {
    if (cluster < 0) {
      clusterLabels.push("Unclustered");
      clusterColors.set(cluster, NOISE_COLOR);
    } else {
      const label = `Cluster ${cluster + 1}`;
      clusterLabels.push(label);
      clusterColors.set(
        cluster,
        CLUSTER_PALETTE[colorIndex % CLUSTER_PALETTE.length],
      );
      colorIndex++;
    }
  }

  return {
    nodes,
    edges,
    clusterLabels,
    clusterColors,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      clusterCount: clusterCounts.size,
    },
  };
}

let _renderCleanup: (() => void) | null = null;

/** Render the graph into a container element. Returns a cleanup function. */
export function renderForceGraph(
  container: HTMLElement,
  graph: BookmarkGraph,
  onNodeClick?: (node: GraphNode) => void,
): () => void {
  // Clean up any previous render
  if (_renderCleanup) {
    _renderCleanup();
    _renderCleanup = null;
  }

  if (graph.nodes.length === 0) {
    container.innerHTML =
      '<p class="cluster-summary">Not enough indexed bookmarks to build a graph.</p>';
    return () => {};
  }

  container.innerHTML = "";

  // Create wrapper
  const wrapper = document.createElement("div");
  wrapper.className = "force-graph-wrapper";

  // Create canvas
  const canvas = document.createElement("canvas");
  canvas.className = "force-graph-canvas";
  wrapper.appendChild(canvas);

  // Create legend
  const legend = buildLegend(graph);
  wrapper.appendChild(legend);

  // Create tooltip
  const tooltip = document.createElement("div");
  tooltip.className = "force-graph-tooltip";
  tooltip.style.display = "none";
  wrapper.appendChild(tooltip);

  container.appendChild(wrapper);

  // Set canvas size
  const rect = container.getBoundingClientRect();
  const width = Math.max(rect.width || 600, 400);
  const height = Math.max(rect.height || 500, 300);
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d")!;
  ctx.scale(devicePixelRatio, devicePixelRatio);

  // Initialize node positions deterministically from bookmark ID hash
  for (const node of graph.nodes) {
    const hash = hashId(node.id);
    node.x = width / 2 + (hash % 200) - 100;
    node.y = height / 2 + ((hash * 7) % 200) - 100;
  }

  // Build d3-force simulation
  const simulation = forceSimulation<GraphNode>(graph.nodes)
    .force("charge", forceManyBody().strength(-80))
    .force(
      "link",
      forceLink<GraphNode, GraphEdge>(graph.edges)
        .id((d: GraphNode) => d.id)
        .distance(60)
        .strength(0.4),
    )
    .force("center", forceCenter(width / 2, height / 2))
    .alphaDecay(ALPHA_DECAY)
    .alphaMin(ALPHA_MIN);

  // State
  let hoveredNode: GraphNode | null = null;
  let highlightedCluster: number | null = null;
  let focusedNodeId: string | null = null;
  let transform = { x: 0, y: 0, k: 1 };

  // Zoom behavior
  const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.2, 4])
    .on("zoom", (event: { transform: { x: number; y: number; k: number } }) => {
      transform = event.transform;
      draw();
    });

  select(canvas).call(zoomBehavior);

  // Mouse interactions
  canvas.addEventListener("mousemove", (event) => {
    const pos = screenToGraph(event.offsetX, event.offsetY, transform);
    const found = findNodeAt(graph.nodes, pos.x, pos.y, transform.k);

    if (found !== hoveredNode) {
      hoveredNode = found;
      canvas.style.cursor = found ? "pointer" : "default";
      if (found) {
        showTooltip(
          tooltip,
          found,
          graph.clusterColors,
          event.clientX,
          event.clientY,
          wrapper,
        );
      } else {
        tooltip.style.display = "none";
      }
      draw();
    }
  });

  canvas.addEventListener("mouseleave", () => {
    hoveredNode = null;
    tooltip.style.display = "none";
    draw();
  });

  canvas.addEventListener("click", (event) => {
    const pos = screenToGraph(event.offsetX, event.offsetY, transform);
    const found = findNodeAt(graph.nodes, pos.x, pos.y, transform.k);
    if (found && onNodeClick) {
      onNodeClick(found);
    }
  });

  // Legend interactions
  legend.addEventListener("clusterHighlight", ((e: Event) => {
    const detail = (e as CustomEvent).detail as { cluster: number | null };
    highlightedCluster = detail.cluster;
    draw();
  }) as EventListener);

  // Draw loop
  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    const isHighlighting = highlightedCluster !== null;
    const isFocusing = focusedNodeId !== null;

    // Determine which nodes/edges to show
    const visibleNodes = new Set<string>();
    const visibleEdges = new Set<string>();

    if (isFocusing && focusedNodeId) {
      // Show focused node + its neighbors
      visibleNodes.add(focusedNodeId);
      for (const edge of graph.edges) {
        const sourceId = edgeNodeId(edge.source);
        const targetId = edgeNodeId(edge.target);
        if (sourceId === focusedNodeId || targetId === focusedNodeId) {
          visibleNodes.add(sourceId);
          visibleNodes.add(targetId);
          visibleEdges.add(`${sourceId}-${targetId}`);
        }
      }
    } else if (isHighlighting && highlightedCluster !== null) {
      for (const node of graph.nodes) {
        if (node.cluster === highlightedCluster) visibleNodes.add(node.id);
      }
      for (const edge of graph.edges) {
        const sourceId = edgeNodeId(edge.source);
        const targetId = edgeNodeId(edge.target);
        if (visibleNodes.has(sourceId) && visibleNodes.has(targetId)) {
          visibleEdges.add(`${sourceId}-${targetId}`);
        }
      }
    } else {
      for (const node of graph.nodes) visibleNodes.add(node.id);
      for (const edge of graph.edges) {
        const sourceId = edgeNodeId(edge.source);
        const targetId = edgeNodeId(edge.target);
        visibleEdges.add(`${sourceId}-${targetId}`);
      }
    }

    // Draw edges
    for (const edge of graph.edges) {
      const sourceId = edgeNodeId(edge.source);
      const targetId = edgeNodeId(edge.target);
      if (!visibleEdges.has(`${sourceId}-${targetId}`)) continue;

      const sourceNode = graph.nodes.find((n) => n.id === sourceId);
      const targetNode = graph.nodes.find((n) => n.id === targetId);
      if (!sourceNode || !targetNode) continue;

      const baseAlpha = Math.max(0.1, Math.min(0.6, edge.similarity));
      const alpha = isHighlighting || isFocusing ? baseAlpha * 1.5 : baseAlpha;

      ctx.beginPath();
      ctx.moveTo(sourceNode.x!, sourceNode.y!);
      ctx.lineTo(targetNode.x!, targetNode.y!);
      ctx.strokeStyle = `rgba(150, 150, 180, ${alpha})`;
      ctx.lineWidth = Math.max(0.5, edge.similarity * 2);
      ctx.stroke();
    }

    // Draw nodes
    for (const node of graph.nodes) {
      if (!visibleNodes.has(node.id)) continue;

      const color = graph.clusterColors.get(node.cluster) ?? NOISE_COLOR;
      const isHovered = hoveredNode === node;
      const radius = isHovered ? HIGHLIGHT_RADIUS : NODE_RADIUS;
      const dimmed =
        (isHighlighting && node.cluster !== highlightedCluster) ||
        (isFocusing && node.id !== focusedNodeId && !visibleNodes.has(node.id));

      ctx.beginPath();
      ctx.arc(node.x!, node.y!, radius, 0, Math.PI * 2);
      ctx.fillStyle = dimmed ? `${color}44` : color;
      ctx.fill();

      if (isHovered) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  simulation.on("tick", draw);

  // Stop simulation after max ticks
  let tickCount = 0;
  const originalTick = simulation.on("tick");
  simulation.on("tick", function () {
    tickCount++;
    if (tickCount >= MAX_SIMULATION_TICKS) {
      simulation.stop();
    }
    originalTick?.call(simulation);
  });

  // Cleanup function
  const cleanup = () => {
    simulation.stop();
    canvas.remove();
    legend.remove();
    tooltip.remove();
    wrapper.remove();
  };
  _renderCleanup = cleanup;

  return cleanup;
}

// ── Graph construction helpers ───────────────────────────────────────────────

function hasUsableScores(scores: Record<string, number>): boolean {
  return Object.values(scores).some(
    (score) => Number.isFinite(score) && score > 0,
  );
}

function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(dot(vector, vector));
  return magnitude ? vector.map((v) => v / magnitude) : vector;
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, v, i) => sum + v * right[i], 0);
}

function cosine(left: number[], right: number[]): number {
  return dot(left, right);
}

function buildClusterLookup(
  clustering: ClusteringResult | undefined,
): Map<string, number> {
  const lookup = new Map<string, number>();
  if (!clustering) return lookup;

  clustering.clusters.forEach((group, index) => {
    for (const bm of group.bookmarks) {
      lookup.set(bm.id, index);
    }
  });

  return lookup;
}

function buildKnnEdges(
  vectors: number[][],
  nodes: GraphNode[],
  k: number,
  threshold: number,
): GraphEdge[] {
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];

  for (let i = 0; i < vectors.length; i++) {
    const neighbors: { index: number; similarity: number }[] = [];

    for (let j = 0; j < vectors.length; j++) {
      if (i === j) continue;
      const sim = cosine(vectors[i], vectors[j]);
      if (sim >= threshold) {
        neighbors.push({ index: j, similarity: sim });
      }
    }

    neighbors.sort((a, b) => b.similarity - a.similarity);
    const topK = neighbors.slice(0, k);

    for (const neighbor of topK) {
      const key =
        nodes[i].id < nodes[neighbor.index].id
          ? `${nodes[i].id}-${nodes[neighbor.index].id}`
          : `${nodes[neighbor.index].id}-${nodes[i].id}`;

      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({
          source: nodes[i].id,
          target: nodes[neighbor.index].id,
          similarity: neighbor.similarity,
        });
      }
    }
  }

  return edges;
}

// ── Deterministic hash for initial positions ─────────────────────────────────

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ── Coordinate helpers ───────────────────────────────────────────────────────

function screenToGraph(
  sx: number,
  sy: number,
  transform: { x: number; y: number; k: number },
): { x: number; y: number } {
  return {
    x: (sx - transform.x) / transform.k,
    y: (sy - transform.y) / transform.k,
  };
}

function findNodeAt(
  nodes: GraphNode[],
  gx: number,
  gy: number,
  zoomK: number,
): GraphNode | null {
  const hitRadius = Math.max(NODE_RADIUS * 1.5, 8 / zoomK);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const dx = node.x! - gx;
    const dy = node.y! - gy;
    if (dx * dx + dy * dy <= hitRadius * hitRadius) {
      return node;
    }
  }
  return null;
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

function showTooltip(
  tooltip: HTMLElement,
  node: GraphNode,
  clusterColors: Map<number, string>,
  clientX: number,
  clientY: number,
  wrapper: HTMLElement,
) {
  const color = clusterColors.get(node.cluster) ?? NOISE_COLOR;
  const clusterName =
    node.cluster < 0 ? "Unclustered" : `Cluster ${node.cluster + 1}`;

  const topTerms = Object.entries(node.wordScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([term]) => term);

  tooltip.innerHTML = `
    <div class="tooltip-title">${escapeHtml(node.title || node.url)}</div>
    <div class="tooltip-url">${escapeHtml(node.url)}</div>
    <div class="tooltip-cluster">
      <span class="tooltip-color-dot" style="background:${color}"></span>
      ${escapeHtml(clusterName)}
    </div>
    ${topTerms.length ? `<div class="tooltip-terms">${topTerms.join(" · ")}</div>` : ""}
  `;

  // Position tooltip near the cursor
  tooltip.style.display = "block";
  const rect = wrapper.getBoundingClientRect();
  const offsetX = clientX - rect.left + 14;
  const offsetY = clientY - rect.top - 10;

  // Ensure tooltip stays within the wrapper bounds
  const tooltipRect = tooltip.getBoundingClientRect();
  const maxX = rect.width - tooltipRect.width - 8;
  const maxY = rect.height - tooltipRect.height - 8;

  tooltip.style.left = `${Math.min(offsetX, maxX)}px`;
  tooltip.style.top = `${Math.min(offsetY, maxY)}px`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Legend ───────────────────────────────────────────────────────────────────

function buildLegend(graph: BookmarkGraph): HTMLElement {
  const legend = document.createElement("div");
  legend.className = "force-graph-legend";

  const title = document.createElement("div");
  title.className = "legend-title";
  title.textContent = "Clusters";
  legend.appendChild(title);

  for (let i = 0; i < graph.clusterLabels.length; i++) {
    const label = graph.clusterLabels[i];
    // Find the cluster number for this label
    let clusterNum = -1;
    for (const [num, _color] of graph.clusterColors) {
      const expectedLabel = num < 0 ? "Unclustered" : `Cluster ${num + 1}`;
      if (expectedLabel === label) {
        clusterNum = num;
        break;
      }
    }

    const color = graph.clusterColors.get(clusterNum) ?? NOISE_COLOR;
    const item = document.createElement("div");
    item.className = "legend-item";
    item.dataset.cluster = String(clusterNum);

    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.backgroundColor = color;

    const text = document.createElement("span");
    text.className = "legend-text";
    text.textContent = label;

    const count = document.createElement("span");
    count.className = "legend-count";
    count.textContent = String(
      graph.nodes.filter((n) => n.cluster === clusterNum).length,
    );

    item.appendChild(dot);
    item.appendChild(text);
    item.appendChild(count);

    item.addEventListener("mouseenter", () => {
      legend.dispatchEvent(
        new CustomEvent("clusterHighlight", {
          detail: { cluster: clusterNum },
        }),
      );
      item.classList.add("active");
    });

    item.addEventListener("mouseleave", () => {
      legend.dispatchEvent(
        new CustomEvent("clusterHighlight", {
          detail: { cluster: null },
        }),
      );
      item.classList.remove("active");
    });

    legend.appendChild(item);
  }

  return legend;
}
