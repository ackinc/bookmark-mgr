/// <reference types="chrome" />

let _allWords: Set<string> | null = null;
let _stopWords: Set<string> | null = null;

async function loadWords(): Promise<[Set<string>, Set<string>]> {
  if (_allWords && _stopWords) return [_allWords, _stopWords];

  const [allWordsArr, stopWordsArr] = await Promise.all(
    ["words.txt", "stopwords.txt"].map((filename) =>
      fetch(chrome.runtime.getURL(filename))
        .then((resp) => resp.text())
        .then((contents) => contents.split("\n")),
    ),
  );

  _allWords = new Set(allWordsArr);
  _stopWords = new Set(stopWordsArr);
  return [_allWords, _stopWords];
}

const DEFAULT_FOLDERS = new Set([
  "bookmarks bar",
  "other bookmarks",
  "mobile bookmarks",
]);

export function tokenize(text: string, stopWords: Set<string>): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

function extractUrlKeywords(url: string): string[] {
  const keywords: string[] = [];

  try {
    const parsed = new URL(url);

    const hostname = parsed.hostname.replace(/^www\./, "");
    keywords.push(hostname);

    // Path components: split by "/", keep purely alphabetical parts
    for (const segment of parsed.pathname.split("/")) {
      if (segment.length === 0) continue;
      // Split on hyphens and underscores to get individual words
      for (const word of segment.split(/[-_]/)) {
        keywords.push(word);
      }
    }
  } catch {
    // Invalid URL — skip URL keywords
  }

  return keywords;
}

export async function extractKeywords(
  node: chrome.bookmarks.BookmarkTreeNode,
): Promise<string[]> {
  const [, stopWords] = await loadWords();
  const keywords: string[] = [];

  // Extract keywords from URL (domain + path)
  if (node.url) {
    keywords.push(...extractUrlKeywords(node.url));
  }

  // Extract keywords from folder hierarchy
  let cur = node;
  while (true) {
    keywords.push(...tokenize(cur.title, stopWords));
    if (!cur.parentId) break;
    cur = (await chrome.bookmarks.get(cur.parentId))[0];
    if (DEFAULT_FOLDERS.has(cur.title.toLowerCase())) break;
  }
  return [...new Set(keywords)].sort();
}
