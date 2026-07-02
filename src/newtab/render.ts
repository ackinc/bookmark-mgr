/// <reference types="chrome" />

import { saveExpandedFolders } from "./layout";
import { extractKeywords } from "./bookmarks";

const DEFAULT_FOLDERS = new Set([
  "bookmarks bar",
  "other bookmarks",
  "mobile bookmarks",
]);

export interface RenderCallbacks {
  onNodeClick: (node: chrome.bookmarks.BookmarkTreeNode) => void;
  onNodeDelete: (node: chrome.bookmarks.BookmarkTreeNode) => void;
}

let expandedFolders: Set<string> = new Set();

export function setExpandedFolders(ids: string[]) {
  expandedFolders = new Set(ids);
}

export function render(
  container: HTMLElement,
  tree: chrome.bookmarks.BookmarkTreeNode[],
  callbacks: RenderCallbacks,
) {
  container.innerHTML = "";
  const ul = document.createElement("ul");
  ul.className = "bookmark-tree";

  for (const node of tree) {
    if (!node.title) continue;
    ul.appendChild(renderNode(node, callbacks, 0, []));
  }

  container.appendChild(ul);
}

function renderNode(
  node: chrome.bookmarks.BookmarkTreeNode,
  callbacks: RenderCallbacks,
  depth: number,
  folderChain: string[],
): HTMLLIElement {
  const li = document.createElement("li");
  li.setAttribute("data-id", node.id);

  if (node.children) {
    const isExpanded = expandedFolders.has(node.id);

    const folderHeader = document.createElement("div");
    folderHeader.className = "folder-header";
    folderHeader.style.paddingLeft = `${depth * 20}px`;

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "folder-toggle";
    toggleBtn.textContent = isExpanded ? "▼" : "▶";
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFolder(node.id, toggleBtn, childUl);
    });

    const folderTitle = document.createElement("span");
    folderTitle.className = "folder-title";
    folderTitle.textContent = node.title || "Untitled";

    folderHeader.appendChild(toggleBtn);
    folderHeader.appendChild(folderTitle);
    li.appendChild(folderHeader);

    const childUl = document.createElement("ul");
    childUl.className = "folder-children";
    if (!isExpanded) {
      childUl.classList.add("collapsed");
    }

    for (const child of node.children) {
      childUl.appendChild(renderNode(child, callbacks, depth + 1, [...folderChain, node.title || ""]));
    }

    li.appendChild(childUl);
  } else {
    const bookmarkRow = document.createElement("div");
    bookmarkRow.className = "bookmark-row";
    bookmarkRow.style.paddingLeft = `${depth * 20 + 20}px`;
    bookmarkRow.setAttribute("title", node.title || node.url || "");

    if (node.url) {
      const favicon = document.createElement("img");
      favicon.className = "favicon";
      favicon.src = getFaviconUrl(node.url);
      favicon.alt = "";
      favicon.onerror = () => {
        favicon.src =
          'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666666"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>';
      };
      bookmarkRow.appendChild(favicon);
    }

    const title = document.createElement("span");
    title.className = "bookmark-title";
    title.textContent = node.title || node.url || "";
    bookmarkRow.appendChild(title);

    const titleKeywords = extractKeywords(node.title || "");
    const folderKeywords = folderChain
      .filter((f) => !DEFAULT_FOLDERS.has(f.toLowerCase()))
      .flatMap(extractKeywords);
    const allKeywords = [...new Set([...folderKeywords, ...titleKeywords])];
    if (allKeywords.length > 0) {
      const keywordsEl = document.createElement("div");
      keywordsEl.className = "bookmark-keywords";
      keywordsEl.style.paddingLeft = `${depth * 20 + 44}px`;
      for (const kw of allKeywords) {
        const tag = document.createElement("span");
        tag.className = "keyword-tag";
        tag.textContent = kw;
        keywordsEl.appendChild(tag);
      }
      li.appendChild(keywordsEl);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerHTML = "&#10005;";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      callbacks.onNodeDelete(node);
    });
    bookmarkRow.appendChild(deleteBtn);

    bookmarkRow.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("delete-btn")) return;
      callbacks.onNodeClick(node);
    });

    li.appendChild(bookmarkRow);
  }

  return li;
}

function toggleFolder(
  folderId: string,
  toggleBtn: HTMLButtonElement,
  childUl: HTMLUListElement,
) {
  const isCollapsed = childUl.classList.contains("collapsed");

  if (isCollapsed) {
    childUl.classList.remove("collapsed");
    toggleBtn.textContent = "▼";
    expandedFolders.add(folderId);
  } else {
    childUl.classList.add("collapsed");
    toggleBtn.textContent = "▶";
    expandedFolders.delete(folderId);
  }

  saveExpandedFolders(Array.from(expandedFolders));
}

function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return "";
  }
}
