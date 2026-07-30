/// <reference types="chrome" />

const STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "can",
  "could",
  "dare",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "just",
  "may",
  "might",
  "my",
  "need",
  "no",
  "nor",
  "not",
  "of",
  "on",
  "or",
  "ought",
  "our",
  "out",
  "shall",
  "she",
  "should",
  "so",
  "than",
  "that",
  "the",
  "their",
  "then",
  "these",
  "they",
  "this",
  "those",
  "to",
  "too",
  "up",
  "used",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

const DEFAULT_FOLDERS = new Set([
  "bookmarks bar",
  "other bookmarks",
  "mobile bookmarks",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

export async function extractKeywords(
  node: chrome.bookmarks.BookmarkTreeNode,
): Promise<string[]> {
  const keywords: string[] = [];

  let cur = node;
  while (true) {
    keywords.push(...tokenize(cur.title));
    if (!cur.parentId) break;
    cur = (await chrome.bookmarks.get(cur.parentId))[0];
  }
  return [...new Set(keywords)].sort();
}
