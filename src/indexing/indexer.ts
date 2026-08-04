/// <reference types="chrome" />

import { CURRENT_EXTRACTION_VERSION, extractKeywords } from "./keywords";
import * as db from "../shared/db";

let reconciliationAbortController: AbortController | null = null;

/**
 * Run a full reconciliation of all bookmarks against the index.
 */
export async function reconcileBookmarks(): Promise<void> {
  const rac = reconciliationAbortController;
  if (rac && !rac.signal.aborted) rac.abort();

  const abortController = new AbortController();
  reconciliationAbortController = abortController;

  const roots = await chrome.bookmarks.getTree();

  const allIds: Set<chrome.bookmarks.BookmarkTreeNode["id"]> = new Set();
  const toUpsert: db.BookmarksUpsertEntry[] = [];

  await Promise.all(roots.map(collectNodes));

  if (abortController.signal.aborted) return;

  await cleanStaleRecords(allIds);
  await db.upsertBookmarks(toUpsert);

  const updatedIds = toUpsert.map((e) => e.node.id);
  if (updatedIds.length > 0) broadcastIndexUpdate(updatedIds);

  if (reconciliationAbortController === abortController) {
    reconciliationAbortController = null;
  }

  // helpers

  async function collectNodes(node: chrome.bookmarks.BookmarkTreeNode) {
    if (node.url) {
      allIds.add(node.id);

      const existingRecord = await db.getBookmark(node.id);
      if (
        existingRecord &&
        existingRecord.keywordsExtractionVersion === CURRENT_EXTRACTION_VERSION
      ) {
        return;
      }

      const keywords = await extractKeywords(node);
      toUpsert.push({
        node,
        keywords,
        keywordsExtractionVersion: CURRENT_EXTRACTION_VERSION,
      });
    } else if (node.children) {
      await Promise.all(node.children.map(collectNodes));
    }
  }
}

/**
 * Remove IndexedDB records that no longer exist in Chrome bookmarks.
 */
async function cleanStaleRecords(validIds: Set<string>): Promise<void> {
  const allRecords = await db.getAllBookmarks();
  const idsToRemove = allRecords
    .filter((r) => !validIds.has(r.id))
    .map((r) => r.id);
  await db.removeBookmarks(idsToRemove);
}

/**
 * Handle a newly created or changed bookmark.
 */
export async function handleBookmarkCreatedOrChanged(
  idOrBookmark: string | chrome.bookmarks.BookmarkTreeNode,
  broadcastOnDone: boolean = true,
): Promise<void> {
  let bookmark: chrome.bookmarks.BookmarkTreeNode | undefined = undefined;
  if (typeof idOrBookmark === "string") {
    bookmark = (await chrome.bookmarks.get(idOrBookmark))[0];
  }
  if (!bookmark) return;

  if (bookmark.url) {
    const keywords = await extractKeywords(bookmark);
    await db.upsertBookmarks([
      {
        node: bookmark,
        keywords,
        keywordsExtractionVersion: CURRENT_EXTRACTION_VERSION,
      },
    ]);
  } else {
    const children =
      bookmark.children ?? (await chrome.bookmarks.getChildren(bookmark.id));
    await Promise.all(
      children.map((c) => handleBookmarkCreatedOrChanged(c.id, false)),
    );
  }

  if (broadcastOnDone) broadcastIndexUpdate([bookmark.id]);
}

/**
 * Handle a removed bookmark or folder.
 */
export async function handleBookmarkRemoved(
  bookmark: chrome.bookmarks.BookmarkTreeNode,
): Promise<void> {
  const toRemove: string[] = [];
  await collectIds(bookmark);
  if (toRemove.length > 0) {
    await db.removeBookmarks(toRemove);
    broadcastIndexUpdate([bookmark.id]);
  }

  // helper

  async function collectIds(node: chrome.bookmarks.BookmarkTreeNode) {
    if (node.url) {
      toRemove.push(node.id);
    } else {
      const children =
        node.children ?? (await chrome.bookmarks.getChildren(node.id));
      await Promise.all(children.map(collectIds));
    }
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
