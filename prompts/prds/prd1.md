# PRD: Bookmark Canvas — Chrome New Tab Extension

## Overview

A Chrome extension that replaces the new tab page with an infinite, pannable canvas displaying the user's bookmarks as a spatial, topic-clustered cloud. Bookmarks belonging to the same Chrome bookmark folder are enclosed in a labeled bubble (circle). The canvas is the primary interface — no separate settings page is required for MVP.

---

## Goals

- Replace cognitive overhead of hierarchical bookmark menus with a spatial, at-a-glance view.
- Surface topic relationships visually by placing semantically similar bookmarks near each other.
- Keep folder structure legible via enclosing circles while allowing cross-folder grouping by topic.
- Enable basic bookmark management (move between folders, delete) directly on the canvas.

---

## Technical Constraints

- **Platform:** Chrome Extension, Manifest V3.
- **Permissions required:** `bookmarks`, `storage`, `newtab`.
- **APIs:** `chrome.bookmarks` for read/write; `chrome.storage.local` for persisting canvas layout.
- **No backend.** All computation runs client-side in the extension.
- **Rendering:** HTML/CSS/SVG preferred over `<canvas>` for accessibility and DOM event handling. Use an SVG layer for circle boundaries and an HTML layer (absolutely positioned) for bookmark nodes.
- **Framework:** Vanilla JS or a lightweight framework (Preact/Solid). No heavyweight bundlers unless necessary.

---

## Feature Requirements

### 1. New Tab Takeover

- The extension's `newtab` override replaces Chrome's default new tab page.
- The page background is a neutral dark or light color (user preference is out of scope for MVP; default to dark).
- No address bar, clock, or other widgets — the canvas is the full viewport.

### 2. Pannable Infinite Canvas

- The canvas is infinite in all directions.
- **Pan:** Click and drag on empty canvas space to pan. Cursor changes to `grab`/`grabbing`.
- **Zoom:** Mouse wheel zooms in/out, centered on cursor position. Zoom range: 30%–200%.
- Canvas state (pan offset, zoom level) is persisted to `chrome.storage.local` and restored on next open.
- A **"Reset View"** button (top-right corner) returns to the default zoom/pan that fits all bookmarks in view.

### 3. Bookmark Nodes

Each bookmark is rendered as a pill/chip node containing:

- **Favicon** (16×16, fetched via `https://www.google.com/s2/favicons?domain=<domain>&sz=32`; fallback to a generic globe icon).
- **Title** (truncated to ~30 chars with ellipsis; full title shown in `title` attribute tooltip).
- Node size is uniform (MVP); do not scale by visit frequency.

**Hover state:**

- Node lifts (subtle box-shadow increase).
- A small **✕ delete button** appears in the top-right corner of the node.

**Click behavior:**

- Single click on a node (not on ✕) opens the bookmark URL in the current tab.

### 4. Topic-Based Spatial Layout

Bookmarks are positioned on the canvas using a force-directed layout seeded by topic similarity:

**Similarity signal (in priority order):**

1. Same Chrome bookmark folder → strong attraction.
2. Shared domain (e.g., two `github.com` links) → moderate attraction.
3. Shared keywords in title (simple tokenization; ignore stop words) → weak attraction.

**Layout algorithm:**

- Use a force simulation (e.g., d3-force or a hand-rolled version) run once on first load or when bookmarks change.
- Folder-mates are given a strong spring toward their folder's centroid.
- Non-folder-mate but same-topic bookmarks have a weaker spring.
- All nodes repel each other to prevent overlap.
- Run simulation to stable state (energy below threshold or max 300 iterations), then freeze positions.
- Persist final positions to `chrome.storage.local` keyed by bookmark ID.
- Re-run simulation only when bookmarks are added/removed (not on every tab open).

### 5. Folder Circles (Bubble Boundaries)

Each Chrome bookmark folder is represented by a circle/ellipse drawn on the SVG layer:

- The circle's center is the centroid of its member bookmark positions.
- The circle's radius expands to enclose all member nodes with ~40px padding.
- Circle is rendered as a filled shape with low opacity (e.g., `rgba(255,255,255,0.05)`) and a visible stroke.
- Each circle has a **folder label** displayed at the top of the circle in muted text.
- Circles may overlap (Venn diagram style) when folders share topic space. Overlapping circles use additive opacity — no special intersection rendering needed for MVP.
- Empty folders are not rendered.
- The root bookmark folder and "Bookmarks Bar" / "Other Bookmarks" are treated as top-level folders and each get their own circle.

### 6. Move Bookmark Between Folders (Drag & Drop)

- Bookmark nodes are individually draggable (separate from canvas pan).
- **Initiate drag:** Click and hold on a bookmark node for 200ms (long-press to differentiate from tap-to-open). Alternatively, detect drag intent by movement > 5px before `mouseup`.
- **During drag:**
  - Node follows cursor.
  - Folder circles that the node is hovering over highlight (brighter stroke, slight fill increase).
  - The node's origin circle dims to indicate it will be removed from that folder.
- **On drop:**
  - If dropped inside a different folder circle: call `chrome.bookmarks.move(id, { parentId: targetFolderId })`. Update node position to drop location. Re-compute that folder's circle boundary.
  - If dropped on empty canvas space outside any circle: move bookmark to "Other Bookmarks" folder (or create a top-level uncategorized folder on first use).
  - If dropped back in the same folder: no-op; snap node to drop position within the circle.
- After a move, persist the new position and re-render the affected circles.

### 7. Delete Bookmark

- Clicking the ✕ button on a hovered node triggers deletion.
- Show a brief confirmation toast: "Deleted [title]. Undo" for 4 seconds. Undo calls `chrome.bookmarks.create` to restore it.
- After confirmation timeout, call `chrome.bookmarks.remove(id)`.
- Remove the node from the canvas and recompute the parent folder's circle.

### 8. Live Sync with Chrome Bookmarks

- Listen to `chrome.bookmarks.onCreated`, `onRemoved`, `onMoved`, `onChanged` events.
- On any event, reconcile the canvas state: add/remove/update nodes. Re-run layout simulation for affected nodes only (incremental re-layout, not full reset).

---

## Data Model

### `chrome.storage.local` schema

```json
{
  "canvas": {
    "panX": 0,
    "panY": 0,
    "zoom": 1.0
  },
  "nodePositions": {
    "<bookmarkId>": { "x": 120, "y": 340 }
  },
  "layoutVersion": 1
}
```

- `layoutVersion` increments when the layout algorithm changes, triggering a full re-layout on next load.

---

## UI / Visual Spec

| Element              | Style                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Page background      | `#0f1117`                                                                                                                           |
| Bookmark node        | `background: #1e2130`, `border: 1px solid #2e3250`, `border-radius: 20px`, `padding: 6px 10px`, `font-size: 13px`, `color: #d0d4f0` |
| Node hover           | `box-shadow: 0 4px 16px rgba(0,0,0,0.5)`                                                                                            |
| Delete button        | `16px`, `color: #ff5f5f`, `position: absolute`, top-right of node                                                                   |
| Folder circle stroke | `rgba(120,140,255,0.35)`, `stroke-width: 1.5px`                                                                                     |
| Folder circle fill   | `rgba(120,140,255,0.04)`                                                                                                            |
| Folder label         | `font-size: 11px`, `color: rgba(180,190,255,0.5)`, uppercase                                                                        |
| Toast                | Bottom-center, `background: #2a2d45`, white text, fade in/out                                                                       |

---

## Out of Scope (MVP)

- Search / filter bar.
- Creating new bookmarks from the canvas.
- Renaming bookmarks or folders.
- Nested folder circles (only one level of folder-to-circle mapping).
- Custom node colors or tags.
- Mobile / touch support.
- Multiple bookmark profiles or sync across devices.
- AI/LLM-based semantic clustering (use title keyword overlap only).

---

## Acceptance Criteria

1. Opening a new tab shows the canvas with all bookmarks loaded within 1.5s.
2. Panning and zooming feel smooth (no jank at 60fps) with up to 500 bookmarks.
3. Bookmark nodes are enclosed in the correct folder circles after initial layout.
4. Dragging a node into a different circle updates Chrome's bookmark folder (verifiable in `chrome://bookmarks`).
5. Deleting a bookmark via ✕ removes it from Chrome bookmarks; Undo restores it.
6. Canvas pan/zoom position is restored correctly on next new tab open.
7. Adding a bookmark externally (via `Ctrl+D`) causes it to appear on the canvas within 2 seconds without a full reload.

---

## File Structure (suggested)

```
extension/
  manifest.json
  newtab/
    index.html
    main.js          # entry point: loads bookmarks, initializes canvas
    canvas.js        # pan/zoom, coordinate transforms
    layout.js        # force simulation, position persistence
    render.js        # DOM/SVG node and circle rendering
    bookmarks.js     # chrome.bookmarks wrappers
    style.css
  icons/
    icon16.png
    icon48.png
    icon128.png
```
