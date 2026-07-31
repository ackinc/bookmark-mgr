/// <reference types="chrome" />

const DB_NAME = "pebble";
const DB_VERSION = 1;
const STORE_NAME = "bookmarks";

export interface BookmarkRecord {
  id: string;
  title: string;
  url: string;
  keywords: string[];
  html: string;
}

let _db: IDBDatabase | null = null;

function getDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
        });
        store.createIndex("keywords", "keywords", { multiEntry: true });
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
  entries: { node: chrome.bookmarks.BookmarkTreeNode; keywords: string[] }[],
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const entry of entries) {
      store.put({
        id: entry.node.id,
        title: entry.node.title,
        url: entry.node.url,
        keywords: entry.keywords,
        html: "",
      });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeBookmark(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getBookmark(
  id: string,
): Promise<BookmarkRecord | undefined> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
