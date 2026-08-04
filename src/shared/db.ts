/// <reference types="chrome" />

const DB_NAME = "pebble";
const DB_VERSION = 1;
const BOOKMARKS_STORE_NAME = "bookmarks";
const META_STORE_NAME = "meta";

export interface BookmarkRecord {
  id: string;
  title: string;
  url: string;
  html: string | null;
  htmlUpdatedAt: number | null;
  keywords: string[];
  keywordsUpdatedAt: number | null;
  keywordsExtractionVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

let _db: IDBDatabase | null = null;

function getDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOKMARKS_STORE_NAME)) {
        db.createObjectStore(BOOKMARKS_STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      _db = request.result;
      _db.onclose = () => {
        _db = null;
      };
      resolve(_db);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function upsertBookmarks(
  entries: {
    node: chrome.bookmarks.BookmarkTreeNode;
    keywords?: string[];
    extractionVersion?: number;
    html?: string;
  }[],
): Promise<void> {
  const existingRecords = await getBookmarks(
    entries.map(({ node }) => node.id),
  );

  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKMARKS_STORE_NAME, "readwrite");
    const store = tx.objectStore(BOOKMARKS_STORE_NAME);
    const now = Date.now();
    for (const entry of entries) {
      store.put({
        id: entry.node.id,
        title: entry.node.title,
        url: entry.node.url ?? "",
        keywords:
          entry.keywords ?? existingRecords[entry.node.id]?.keywords ?? [],
        keywordsUpdatedAt: entry.keywords
          ? now
          : (existingRecords[entry.node.id]?.keywordsUpdatedAt ?? null),
        html: entry.html ?? existingRecords[entry.node.id]?.html ?? null,
        htmlUpdatedAt: entry.html
          ? now
          : (existingRecords[entry.node.id]?.htmlUpdatedAt ?? null),
        keywordsExtractionVersion:
          entry.extractionVersion ??
          existingRecords[entry.node.id]?.keywordsExtractionVersion ??
          null,
        createdAt: existingRecords[entry.node.id]?.createdAt ?? now,
        updatedAt: now,
      } satisfies BookmarkRecord);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeBookmarks(ids: string[]): Promise<void> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKMARKS_STORE_NAME, "readwrite");
    const store = tx.objectStore(BOOKMARKS_STORE_NAME);
    const remainingIds = new Set(ids);

    for (const id of ids) {
      const request = store.delete(id);
      request.onsuccess = () => {
        remainingIds.delete(id);
        if (remainingIds.size === 0) resolve();
      };
      request.onerror = () => reject(request.error);
    }
  });
}

export async function removeBookmark(id: string): Promise<void> {
  return await removeBookmarks([id]);
}

export async function getBookmarks(
  ids: string[],
): Promise<Record<string, BookmarkRecord>> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKMARKS_STORE_NAME, "readonly");
    const store = tx.objectStore(BOOKMARKS_STORE_NAME);

    const remainingIds = new Set(ids);
    const results: Record<string, BookmarkRecord> = {};

    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => {
        results[id] = request.result;
        remainingIds.delete(id);
        if (remainingIds.size === 0) resolve(results);
      };
      request.onerror = () => reject(request.error);
    }
  });
}

export async function getBookmark(
  id: string,
): Promise<BookmarkRecord | undefined> {
  return (await getBookmarks([id]))[id];
}

export async function getAllBookmarks(): Promise<BookmarkRecord[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKMARKS_STORE_NAME, "readonly");
    const store = tx.objectStore(BOOKMARKS_STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, "readwrite");
    const store = tx.objectStore(META_STORE_NAME);
    store.put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, "readonly");
    const store = tx.objectStore(META_STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}
