/// <reference types="chrome" />

const STORAGE_KEY = "bookmarkListData";

export interface StoredData {
  expandedFolders: string[];
}

export async function loadStoredData(): Promise<StoredData | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as StoredData) || null;
}

export async function saveExpandedFolders(
  expandedFolders: string[],
): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: { expandedFolders } });
}
