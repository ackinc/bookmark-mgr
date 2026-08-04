# Moving keyword extraction to service worker

Implementation Plan to move keyword extraction to service-worker (phase 1)

1.  Add a Manifest V3 module service worker in public/manifest.json.
2.  Add a stable background.js entry to Vite.
3.  Move extraction out of src/newtab/ into src/indexing/.
4.  Move IndexedDB access into src/shared/ since both contexts use it.
5.  Register bookmark listeners synchronously in the worker.
6.  Lazily load word lists so top-level await cannot delay listener registration.
7.  Let the worker handle:

- Initial/full indexing after install or extraction-version changes
- New and changed bookmarks
- Folder renames and moves, including descendants
- Removed bookmarks and folders

8.  Store extractionVersion and indexing status with each record.
9.  Make the new-tab page:

- Render the bookmark tree immediately
- Read whatever metadata is currently cached
- Request an index check without awaiting completion
- Refresh when the worker broadcasts updated bookmark IDs

10. Coalesce rapid bookmark events and debounce new-tab refreshes.
    Data Flow
    chrome.bookmarks event
    |
    service worker index queue
    |
    keyword extraction
    |
    shared IndexedDB
    |
    runtime message: index updated
    |
    new-tab refreshes cached metadata
    Missing metadata would simply produce no keyword tags until extraction finishes.
    For MV3 reliability, the worker should persist a dirty/index-version marker before a full reconciliation. If Chrome terminates it midway, the next activation or new-tab index check resumes reconciliation rather than treating a partial index as complete.
    Verification

- Run pnpm typecheck and pnpm build.
- Load dist/ unpacked and verify service-worker registration.
- Test create, rename, move, and delete for both bookmarks and folders.
- Verify existing bookmarks are reindexed after the upgrade.
- Verify opening a new tab does not block on extraction.
