/// <reference types="chrome" />

interface Settings {
  expandedFolders: string[];
}

export async function getSetting<T>(name: keyof Settings): Promise<T> {
  const key = `setting:${name}`;
  const result = await chrome.storage.local.get<{ [key: string]: T }>([key]);
  return result[key];
}

export async function setSetting(
  name: keyof Settings,
  value: unknown,
): Promise<void> {
  const key = `setting:${name}`;
  await chrome.storage.local.set({ key, value });
}
