# bookmark-mgr

Chrome extension that replaces the new tab page with a bookmark list.

## Commands

- `pnpm dev` — watch mode (runs `tsc --noEmit --watch` + `vite build --watch` concurrently)
- `pnpm build` — production build to `dist/`
- `pnpm typecheck` — `tsc --noEmit`

No test or lint scripts exist.

## Architecture

- **Single entry point**: `src/newtab/index.html` → `src/newtab/main.ts`
- **Files**: `bookmarks.ts` (Chrome API wrappers), `layout.ts` (state persistence), `render.ts` (DOM rendering), `style.css`
- Uses `chrome.bookmarks` API directly — no framework
- Vite custom plugin flattens `dist/src/` into `dist/` after each build

## Gotchas

- `pnpm dev` runs `tsc --noEmit --watch` (type-check only, no emit) alongside Vite. Type errors appear in the terminal but do not block the Vite build.
- Build output is a Chrome extension page, not a standalone website. Test by loading `dist/` as an unpacked extension.
- Requires `@types/chrome` for the `chrome` global.
