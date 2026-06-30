import type { CanvasState } from './layout'
import { saveCanvasState } from './layout'

export interface ViewportTransform {
  panX: number
  panY: number
  zoom: number
}

const MIN_ZOOM = 0.3
const MAX_ZOOM = 2.0

export function createCanvasController(
  container: HTMLElement,
  onTransformChange: (transform: ViewportTransform) => void,
) {
  let transform: ViewportTransform = { panX: 0, panY: 0, zoom: 1 }
  let isPanning = false
  let startX = 0
  let startY = 0

  function applyTransform() {
    container.style.transform = `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.zoom})`
    container.style.transformOrigin = '0 0'
  }

  function updateTransform(newTransform: ViewportTransform) {
    transform = newTransform
    applyTransform()
    onTransformChange(transform)
  }

  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.bookmark-node')) return

    isPanning = true
    startX = e.clientX - transform.panX
    startY = e.clientY - transform.panY
    container.classList.add('grabbing')
    e.preventDefault()
  })

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return

    updateTransform({
      ...transform,
      panX: e.clientX - startX,
      panY: e.clientY - startY,
    })
  })

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false
      container.classList.remove('grabbing')
    }
  })

  container.addEventListener('wheel', (e) => {
    e.preventDefault()

    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, transform.zoom * delta))

    const rect = container.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    const scale = newZoom / transform.zoom
    const newPanX = mouseX - (mouseX - transform.panX) * scale
    const newPanY = mouseY - (mouseY - transform.panY) * scale

    updateTransform({
      panX: newPanX,
      panY: newPanY,
      zoom: newZoom,
    })
  }, { passive: false })

  function setTransform(newTransform: ViewportTransform) {
    updateTransform(newTransform)
  }

  function getTransform(): ViewportTransform {
    return { ...transform }
  }

  function fitView(contentWidth: number, contentHeight: number, centerX: number, centerY: number) {
    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight

    const padding = 80
    const scaleX = (containerWidth - padding * 2) / contentWidth
    const scaleY = (containerHeight - padding * 2) / contentHeight
    const zoom = Math.min(scaleX, scaleY, 1)

    const panX = containerWidth / 2 - centerX * zoom
    const panY = containerHeight / 2 - centerY * zoom

    updateTransform({ panX, panY, zoom })
  }

  return { setTransform, getTransform, fitView, applyTransform }
}

export function transformToCanvas(
  clientX: number,
  clientY: number,
  transform: ViewportTransform,
  containerRect: DOMRect,
): { x: number; y: number } {
  const x = (clientX - containerRect.left - transform.panX) / transform.zoom
  const y = (clientY - containerRect.top - transform.panY) / transform.zoom
  return { x, y }
}
