/// <reference types="chrome" />

import { extractKeywords } from "./keywords";
import * as db from "../shared/db";

const INDEX_META_KEY = "indexState";

interface IndexState {
  extractionVersion: number;
  lastFullIndexAt: number;
  dirty: boolean;
}

async function getIndexState(): Promise<IndexState> {
  const stored = await db.getMeta<IndexState>(INDEX_META_KEY);
  return (
    stored ?? {
      extractionVersion: 0,
      lastFullIndexAt: 0,
      dirty: false,
    }
  );
}

async function setIndexState(state: IndexState): Promise<void> {
  await db.setMeta(INDEX_META_KEY, state);
}

/**
 * Run a full reconciliation of all bookmarks against the index.
 * Marks state dirty before starting so partial runs can resume.
 */
export async function runFullIndex(): Promise<void> {
  const state = await getIndexState();
  state.dirty = true;
  state.extractionVersion = db.CURRENT_EXTRACTION_VERSION;
  await setIndexState(state);

  const roots = await chrome.bookmarks.getTree();
  const toUpsert: {
    node: chrome.bookmarks.BookmarkTreeNode;
    keywords: string[];
  }[] = [];

  async function collectNodes(node: chrome.bookmarks.BookmarkTreeNode) {
    if (node.url) {
      const keywords = await extractKeywords(node);
      toUpsert.push({ node, keywords });
    }
    if (node.children) {
      await Promise.all(node.children.map(collectNodes));
    }
  }
  await Promise.all(roots.map(collectNodes));

  // Upsert in batches to avoid long-running transactions
  const BATCH_SIZE = 100;
  for (let i = 0; i < toUpsert.length; i += BATCH_SIZE) {
    await db.upsertBookmarks(toUpsert.slice(i, i + BATCH_SIZE));
  }

  // Clean up stale records (bookmarks that no longer exist)
  await cleanStaleRecords(toUpsert.map((e) => e.node.id));

  state.dirty = false;
  state.lastFullIndexAt = Date.now();
  await setIndexState(state);

  // Notify UI of updated IDs
  const updatedIds = toUpsert.map((e) => e.node.id);
  if (updatedIds.length > 0) {
    broadcastIndexUpdate(updatedIds);
  }
}

/**
 * Remove IndexedDB records that no longer exist in Chrome bookmarks.
 */
async function cleanStaleRecords(
  validIds: Set<string> | string[],
): Promise<void> {
  const validSet = Array.isArray(validIds) ? new Set(validIds) : validIds;
  const allRecords = await db.getAllBookmarks();
  const toRemove = allRecords.filter((r) => !validSet.has(r.id));
  for (const record of toRemove) {
    await db.removeBookmark(record.id);
  }
}

/**
 * Handle a newly created or changed bookmark.
 */
export async function handleBookmarkCreatedOrChanged(
  id: string,
): Promise<void> {
  const bookmark = (await chrome.bookmarks.get(id))[0];
  if (!bookmark) return;

  if (bookmark.url) {
    const keywords = await extractKeywords(bookmark);
    await db.upsertBookmarks([{ node: bookmark, keywords }]);
    broadcastIndexUpdate([bookmark.id]);
  } else {
    // Folder changed — reindex all descendants
    await reindexFolderDescendants(bookmark);
  }
}

/**
 * Reindex all bookmark URLs under a folder (including the folder itself if it somehow has a URL).
 */
async function reindexFolderDescendants(
  folder: chrome.bookmarks.BookmarkTreeNode,
): Promise<void> {
  const children =
    folder.children ?? (await chrome.bookmarks.getChildren(folder.id));
  const updatedIds: string[] = [];

  async function processNode(node: chrome.bookmarks.BookmarkTreeNode) {
    if (node.url) {
      const keywords = await extractKeywords(node);
      await db.upsertBookmarks([{ node, keywords }]);
      updatedIds.push(node.id);
    }
    if (node.children) {
      for (const child of node.children) {
        await processNode(child);
      }
    }
  }

  for (const child of children) {
    await processNode(child);
  }

  if (updatedIds.length > 0) {
    broadcastIndexUpdate(updatedIds);
  }
}

/**
 * Handle a removed bookmark or folder.
 */
export async function handleBookmarkRemoved(
  bookmark: chrome.bookmarks.BookmarkTreeNode,
): Promise<void> {
  const removedIds: string[] = [];

  async function collectIds(node: chrome.bookmarks.BookmarkTreeNode) {
    if (node.url) {
      await db.removeBookmark(node.id);
      removedIds.push(node.id);
    }
    if (node.children) {
      for (const child of node.children) {
        await collectIds(child);
      }
    }
  }

  await collectIds(bookmark);

  if (removedIds.length > 0) {
    broadcastIndexUpdate(removedIds);
  }
}

/**
 * Notify all open extension pages that specific bookmark IDs were updated.
 */
function broadcastIndexUpdate(ids: string[]): void {
  chrome.runtime.sendMessage({ type: "indexUpdated", ids }).catch(() => {
    // No listeners available — expected if no tabs are open
  });
}

/**
 * Check if a full index is needed and run it if so.
 * Called on worker startup and when the new-tab page requests it.
 */
export async function checkAndRunIndex(): Promise<void> {
  const state = await getIndexState();

  // Run full index if:
  // - Never indexed before
  // - Extraction version changed
  // - Previous run was interrupted (dirty flag)
  if (
    state.extractionVersion !== db.CURRENT_EXTRACTION_VERSION ||
    state.dirty ||
    state.lastFullIndexAt === 0
  ) {
    await runFullIndex();
  }
}
