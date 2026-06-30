/// <reference types="chrome" />

import type { BookmarkNode, BookmarkFolder } from './bookmarks'
import type { NodePositions, Position } from './layout'
import { computeFolderCircles } from './layout'
import type { ViewportTransform } from './canvas'
import { transformToCanvas } from './canvas'

export interface RenderCallbacks {
  onNodeClick: (node: BookmarkNode) => void
  onNodeDelete: (node: BookmarkNode) => void
  onNodeDragStart: (node: BookmarkNode, e: MouseEvent) => void
}

let currentPositions: NodePositions = {}
let currentFolders: BookmarkFolder[] = []
let currentNodes: BookmarkNode[] = []
let dragState: {
  node: BookmarkNode
  startX: number
  startY: number
  isDragging: boolean
  element: HTMLElement | null
} | null = null

export function render(
  svgLayer: SVGSVGElement,
  htmlLayer: HTMLElement,
  nodes: BookmarkNode[],
  folders: BookmarkFolder[],
  positions: NodePositions,
  callbacks: RenderCallbacks,
) {
  currentPositions = positions
  currentFolders = folders
  currentNodes = nodes

  renderCircles(svgLayer, folders, positions)
  renderNodes(htmlLayer, nodes, positions, callbacks)
}

function renderCircles(
  svgLayer: SVGSVGElement,
  folders: BookmarkFolder[],
  positions: NodePositions,
) {
  svgLayer.innerHTML = ''

  const circles = computeFolderCircles(folders, positions)

  for (const circle of circles) {
    const circleEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    circleEl.setAttribute('cx', circle.cx.toString())
    circleEl.setAttribute('cy', circle.cy.toString())
    circleEl.setAttribute('r', circle.r.toString())
    circleEl.setAttribute('class', 'folder-circle')
    circleEl.setAttribute('data-folder-id', circle.folderId)
    svgLayer.appendChild(circleEl)

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('x', circle.cx.toString())
    label.setAttribute('y', (circle.cy - circle.r - 10).toString())
    label.setAttribute('class', 'folder-label')
    label.textContent = circle.title
    svgLayer.appendChild(label)
  }
}

function renderNodes(
  htmlLayer: HTMLElement,
  nodes: BookmarkNode[],
  positions: NodePositions,
  callbacks: RenderCallbacks,
) {
  htmlLayer.innerHTML = ''

  for (const node of nodes) {
    const pos = positions[node.id]
    if (!pos) continue

    const el = createNodeElement(node, pos, callbacks)
    htmlLayer.appendChild(el)
  }
}

function createNodeElement(
  node: BookmarkNode,
  pos: Position,
  callbacks: RenderCallbacks,
): HTMLElement {
  const el = document.createElement('div')
  el.className = 'bookmark-node'
  el.style.left = `${pos.x}px`
  el.style.top = `${pos.y}px`
  el.setAttribute('data-id', node.id)
  el.setAttribute('title', node.title)

  if (node.favicon) {
    const img = document.createElement('img')
    img.className = 'favicon'
    img.src = node.favicon
    img.alt = ''
    img.onerror = () => {
      img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23d0d4f0"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>'
    }
    el.appendChild(img)
  }

  const title = document.createElement('span')
  title.className = 'title'
  title.textContent = node.title.length > 30 ? node.title.slice(0, 30) + '...' : node.title
  el.appendChild(title)

  const deleteBtn = document.createElement('button')
  deleteBtn.className = 'delete-btn'
  deleteBtn.innerHTML = '&#10005;'
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    callbacks.onNodeDelete(node)
  })
  el.appendChild(deleteBtn)

  el.addEventListener('click', (e) => {
    if (dragState?.isDragging) return
    callbacks.onNodeClick(node)
  })

  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).classList.contains('delete-btn')) return

    e.stopPropagation()

    const startX = e.clientX
    const startY = e.clientY
    let hasMoved = false

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      if (Math.sqrt(dx * dx + dy * dy) > 5) {
        hasMoved = true
        dragState = { node, startX, startY, isDragging: true, element: el }
        el.classList.add('dragging')
        callbacks.onNodeDragStart(node, moveEvent)
      }
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (dragState?.element === el) {
        dragState = null
      }
      el.classList.remove('dragging')
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  })

  return el
}

export function updateNodePosition(
  htmlLayer: HTMLElement,
  nodeId: string,
  pos: Position,
) {
  const el = htmlLayer.querySelector(`[data-id="${nodeId}"]`) as HTMLElement | null
  if (el) {
    el.style.left = `${pos.x}px`
    el.style.top = `${pos.y}px`
  }
  currentPositions[nodeId] = pos
}

export function highlightFolderCircle(
  svgLayer: SVGSVGElement,
  folderId: string | null,
) {
  const circles = svgLayer.querySelectorAll('.folder-circle')
  circles.forEach((circle) => {
    const el = circle as SVGElement
    if (folderId && el.getAttribute('data-folder-id') === folderId) {
      el.classList.add('highlighted')
      el.classList.remove('dimmed')
    } else if (folderId === null) {
      el.classList.remove('highlighted', 'dimmed')
    } else {
      el.classList.remove('highlighted')
    }
  })
}

export function dimOriginCircle(
  svgLayer: SVGSVGElement,
  folderId: string,
) {
  const circle = svgLayer.querySelector(`.folder-circle[data-folder-id="${folderId}"]`) as SVGElement | null
  if (circle) {
    circle.classList.add('dimmed')
  }
}

export function findFolderAtPosition(
  folders: BookmarkFolder[],
  positions: NodePositions,
  canvasX: number,
  canvasY: number,
): BookmarkFolder | null {
  const circles = computeFolderCircles(folders, positions)

  for (const circle of circles) {
    const dist = Math.sqrt((canvasX - circle.cx) ** 2 + (canvasY - circle.cy) ** 2)
    if (dist <= circle.r) {
      const folder = folders.find((f) => f.id === circle.folderId)
      if (folder) return folder
    }
  }

  return null
}

export function removeNodeFromDOM(htmlLayer: HTMLElement, nodeId: string) {
  const el = htmlLayer.querySelector(`[data-id="${nodeId}"]`)
  if (el) el.remove()
}

export function addNodeToDOM(
  htmlLayer: HTMLElement,
  node: BookmarkNode,
  pos: Position,
  callbacks: RenderCallbacks,
) {
  const el = createNodeElement(node, pos, callbacks)
  htmlLayer.appendChild(el)
}
