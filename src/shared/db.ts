/// <reference types="chrome" />

const DB_NAME = "pebble";
const DB_VERSION = 2;
const BOOKMARKS_STORE_NAME = "bookmarks";
const META_STORE_NAME = "meta";
const WORDS_STORE_NAME = "words";

export interface WordRecord {
  word: string;
  bookmark_ids: string[];
  idf: number;
}

export interface BookmarkRecord {
  id: string;
  title: string;
  url: string;
  html: string | null;
  htmlUpdatedAt: number | null;
  keywords: string[];
  keywordsUpdatedAt: number | null;
  keywordsExtractionVersion: number;
  wordScores: Record<string, number>;
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
      if (!db.objectStoreNames.contains(WORDS_STORE_NAME)) {
        db.createObjectStore(WORDS_STORE_NAME, { keyPath: "word" });
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

export type BookmarksUpsertEntry = {
  node: chrome.bookmarks.BookmarkTreeNode;
} & (
  | {
      keywords: string[];
      keywordsExtractionVersion: number;
    }
  | {
      html: string;
    }
  | {
      wordScores: Record<string, number>;
    }
);
export async function upsertBookmarks(
  entries: BookmarksUpsertEntry[],
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
      const existing = existingRecords[entry.node.id];
      store.put({
        id: entry.node.id,
        title: entry.node.title,
        url: entry.node.url ?? "",
        html: "html" in entry ? entry.html : (existing?.html ?? null),
        htmlUpdatedAt:
          "html" in entry ? now : (existing?.htmlUpdatedAt ?? null),
        keywords:
          "keywords" in entry ? entry.keywords : (existing?.keywords ?? []),
        keywordsExtractionVersion:
          "keywords" in entry
            ? entry.keywordsExtractionVersion
            : (existing?.keywordsExtractionVersion ?? 1),
        keywordsUpdatedAt:
          "keywords" in entry ? now : (existing?.keywordsUpdatedAt ?? null),
        wordScores:
          "wordScores" in entry
            ? entry.wordScores
            : (existing?.wordScores ?? {}),
        createdAt: existing?.createdAt ?? now,
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

    if (ids.length === 0) return resolve();
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

    if (ids.length === 0) return resolve(results);
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

export async function getAllWords(): Promise<WordRecord[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WORDS_STORE_NAME, "readonly");
    const store = tx.objectStore(WORDS_STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getWord(word: string): Promise<WordRecord | undefined> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WORDS_STORE_NAME, "readonly");
    const store = tx.objectStore(WORDS_STORE_NAME);
    const request = store.get(word);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Atomically update all bookmark wordScores and replace the entire words store.
 * Both stores are updated in a single readwrite transaction to guarantee consistency.
 */
export async function rebuildTfidfVectors(params: {
  wordScoresByBookmarkId: Record<string, Record<string, number>>;
  words: WordRecord[];
}): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [BOOKMARKS_STORE_NAME, WORDS_STORE_NAME],
      "readwrite",
    );
    const bookmarkStore = tx.objectStore(BOOKMARKS_STORE_NAME);
    const wordsStore = tx.objectStore(WORDS_STORE_NAME);

    // Update each bookmark's wordScores
    const bookmarkIds = Object.keys(params.wordScoresByBookmarkId);
    for (const id of bookmarkIds) {
      const getRequest = bookmarkStore.get(id);
      getRequest.onsuccess = () => {
        const record = getRequest.result as BookmarkRecord | undefined;
        if (record) {
          record.wordScores = params.wordScoresByBookmarkId[id];
          bookmarkStore.put(record);
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    }

    // Clear and repopulate the words store
    const clearRequest = wordsStore.clear();
    clearRequest.onerror = () => reject(clearRequest.error);
    clearRequest.onsuccess = () => {
      for (const wordRecord of params.words) {
        const putRequest = wordsStore.put(wordRecord);
        putRequest.onerror = () => reject(putRequest.error);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
