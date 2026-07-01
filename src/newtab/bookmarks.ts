/// <reference types="chrome" />

export interface BookmarkNode {
  id: string;
  title: string;
  url: string;
  parentId: string | null;
  favicon: string;
}

export interface BookmarkFolder {
  id: string;
  title: string;
  parentId: string | null;
  children: BookmarkNode[];
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "need",
  "dare",
  "ought",
  "used",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "what",
  "which",
  "who",
  "whom",
  "how",
  "when",
  "where",
  "why",
  "not",
  "no",
  "nor",
  "so",
  "if",
  "then",
  "than",
  "too",
  "very",
  "just",
  "about",
  "up",
  "out",
  "my",
  "your",
  "his",
  "her",
  "our",
  "their",
]);

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
}

function getFaviconUrl(url: string): string {
  const domain = getDomain(url);
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

function extractKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

export async function getAllBookmarks(): Promise<{
  folders: BookmarkFolder[];
  nodes: BookmarkNode[];
}> {
  const tree = await chrome.bookmarks.getTree();
  const folders: BookmarkFolder[] = [];
  const nodes: BookmarkNode[] = [];

  function traverse(
    treeNode: chrome.bookmarks.BookmarkTreeNode,
    parentId: string | null = null,
  ) {
    if (treeNode.children) {
      const folder: BookmarkFolder = {
        id: treeNode.id,
        title: treeNode.title || "Untitled",
        parentId,
        children: [],
      };
      folders.push(folder);

      for (const child of treeNode.children) {
        if (child.url) {
          const node: BookmarkNode = {
            id: child.id,
            title: child.title || child.url,
            url: child.url,
            parentId: treeNode.id,
            favicon: getFaviconUrl(child.url),
          };
          nodes.push(node);
          folder.children.push(node);
        } else {
          traverse(child, treeNode.id);
        }
      }
    }
  }

  for (const root of tree) {
    traverse(root);
  }

  return { folders, nodes };
}

export function getSimilarity(
  a: BookmarkNode,
  b: BookmarkNode,
): { sameFolder: boolean; sameDomain: boolean; sharedKeywords: number } {
  const sameFolder = a.parentId === b.parentId;
  const domainA = getDomain(a.url);
  const domainB = getDomain(b.url);
  const sameDomain = domainA !== "" && domainA === domainB;

  const keywordsA = extractKeywords(a.title);
  const keywordsB = extractKeywords(b.title);
  let sharedKeywords = 0;
  for (const kw of keywordsA) {
    if (keywordsB.includes(kw)) sharedKeywords++;
  }

  return { sameFolder, sameDomain, sharedKeywords };
}

export async function moveBookmark(
  id: string,
  parentId: string,
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  return chrome.bookmarks.move(id, { parentId });
}

export async function deleteBookmark(id: string): Promise<void> {
  return chrome.bookmarks.remove(id);
}

export async function createBookmark(
  url: string,
  title: string,
  parentId: string,
): Promise<chrome.bookmarks.BookmarkTreeNode> {
  return chrome.bookmarks.create({ url, title, parentId });
}

export function subscribeToChanges(callback: () => void): void {
  chrome.bookmarks.onCreated.addListener(callback);
  chrome.bookmarks.onRemoved.addListener(callback);
  chrome.bookmarks.onMoved.addListener(callback);
  chrome.bookmarks.onChanged.addListener(callback);
}
