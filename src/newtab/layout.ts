/// <reference types="chrome" />

import { forceSimulation, forceManyBody, forceCenter, forceLink, forceCollide } from 'd3-force'
import type { BookmarkNode, BookmarkFolder } from './bookmarks'
import { getSimilarity } from './bookmarks'

export interface Position {
  x: number
  y: number
}

export interface CanvasState {
  panX: number
  panY: number
  zoom: number
}

export interface NodePositions {
  [bookmarkId: string]: Position
}

export interface StoredData {
  canvas: CanvasState
  nodePositions: NodePositions
  layoutVersion: number
}

const LAYOUT_VERSION = 1
const STORAGE_KEY = 'bookmarkCanvasData'

export async function loadStoredData(): Promise<StoredData | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  return (result[STORAGE_KEY] as StoredData) || null
}

export async function saveCanvasState(state: CanvasState): Promise<void> {
  const existing = await loadStoredData()
  const data: StoredData = {
    canvas: state,
    nodePositions: existing?.nodePositions || {},
    layoutVersion: existing?.layoutVersion || LAYOUT_VERSION,
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: data })
}

export async function saveNodePositions(positions: NodePositions): Promise<void> {
  const existing = await loadStoredData()
  const data: StoredData = {
    canvas: existing?.canvas || { panX: 0, panY: 0, zoom: 1 },
    nodePositions: positions,
    layoutVersion: LAYOUT_VERSION,
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: data })
}

export function needsFullRelayout(stored: StoredData | null): boolean {
  return !stored || stored.layoutVersion !== LAYOUT_VERSION
}

interface SimNode {
  id: string
  x: number
  y: number
  vx?: number
  vy?: number
}

interface SimLink {
  source: string
  target: string
  strength: number
}

export function computeLayout(
  nodes: BookmarkNode[],
  folders: BookmarkFolder[],
  existingPositions: NodePositions | null,
): NodePositions {
  if (nodes.length === 0) return {}

  const simNodes: SimNode[] = nodes.map((n) => {
    const existing = existingPositions?.[n.id]
    return {
      id: n.id,
      x: existing?.x ?? Math.random() * 800 - 400,
      y: existing?.y ?? Math.random() * 600 - 300,
    }
  })

  const links: SimLink[] = []

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const sim = getSimilarity(nodes[i], nodes[j])

      if (sim.sameFolder) {
        links.push({ source: nodes[i].id, target: nodes[j].id, strength: 0.8 })
      } else if (sim.sameDomain) {
        links.push({ source: nodes[i].id, target: nodes[j].id, strength: 0.3 })
      } else if (sim.sharedKeywords > 0) {
        const strength = Math.min(sim.sharedKeywords * 0.1, 0.3)
        links.push({ source: nodes[i].id, target: nodes[j].id, strength })
      }
    }
  }

  const simulation = forceSimulation<SimNode>(simNodes)
    .force('charge', forceManyBody().strength(-80))
    .force('center', forceCenter(0, 0).strength(0.05))
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .strength((d) => d.strength)
        .distance(80),
    )
    .force('collide', forceCollide<SimNode>().radius(50).strength(0.7))
    .stop()

  for (let i = 0; i < 300; i++) {
    simulation.tick()
  }

  const positions: NodePositions = {}
  for (const node of simNodes) {
    positions[node.id] = { x: node.x, y: node.y }
  }

  return positions
}

export function computeFolderCircles(
  folders: BookmarkFolder[],
  positions: NodePositions,
  padding: number = 40,
): { folderId: string; cx: number; cy: number; r: number; title: string }[] {
  const circles: { folderId: string; cx: number; cy: number; r: number; title: string }[] = []

  for (const folder of folders) {
    const memberPositions = folder.children
      .map((n) => positions[n.id])
      .filter((p): p is Position => p !== undefined)

    if (memberPositions.length === 0) continue

    const cx = memberPositions.reduce((sum, p) => sum + p.x, 0) / memberPositions.length
    const cy = memberPositions.reduce((sum, p) => sum + p.y, 0) / memberPositions.length

    let maxDist = 0
    for (const p of memberPositions) {
      const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2)
      if (dist > maxDist) maxDist = dist
    }

    circles.push({
      folderId: folder.id,
      cx,
      cy,
      r: maxDist + padding,
      title: folder.title,
    })
  }

  return circles
}
