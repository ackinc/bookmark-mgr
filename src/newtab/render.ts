/// <reference types="chrome" />

import { showToast } from "./toast";

const expandedFolders: Set<chrome.bookmarks.BookmarkTreeNode["id"]> = new Set();

export function render(
  container: HTMLElement,
  tree: chrome.bookmarks.BookmarkTreeNode[],
  keywordsMap: Map<chrome.bookmarks.BookmarkTreeNode["id"], string[]>,
) {
  container.innerHTML = "";
  const ul = document.createElement("ul");
  ul.className = "bookmark-tree";

  const toRender = tree
    .flatMap((node) => node.children ?? [])
    .flatMap((node) => node.children ?? []);

  for (const node of toRender) {
    ul.appendChild(renderNode(node, 0, [], keywordsMap));
  }

  container.appendChild(ul);
}

function renderNode(
  node: chrome.bookmarks.BookmarkTreeNode,
  depth: number,
  folderChain: string[],
  keywordsMap: Map<string, string[]>,
): HTMLLIElement {
  const li = document.createElement("li");
  li.setAttribute("data-id", node.id);

  if (node.children) {
    const isExpanded = expandedFolders.has(node.id);

    const folderHeader = document.createElement("div");
    folderHeader.className = "folder-header";
    folderHeader.style.paddingLeft = `${depth * 20}px`;

    folderHeader.addEventListener("dragover", (e) => {
      e.preventDefault();
      folderHeader.classList.add("drag-over");
    });

    folderHeader.addEventListener("dragleave", () => {
      folderHeader.classList.remove("drag-over");
    });

    folderHeader.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      folderHeader.classList.remove("drag-over");
      const bookmarkId = e.dataTransfer?.getData("text/plain");
      if (!bookmarkId || bookmarkId === node.id) return;
      handleNodeMove(bookmarkId, node.id);
    });

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "folder-toggle";
    toggleBtn.textContent = isExpanded ? "▼" : "▶";

    const folderTitle = document.createElement("span");
    folderTitle.className = "folder-title";
    folderTitle.textContent = node.title || "Untitled";

    folderHeader.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFolder(node.id, toggleBtn, childUl);
    });

    folderHeader.appendChild(toggleBtn);
    folderHeader.appendChild(folderTitle);

    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.innerHTML = "&#9998;";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleNodeEdit(node);
    });
    folderHeader.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerHTML = "&#10005;";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleNodeDelete(node);
    });
    folderHeader.appendChild(deleteBtn);

    li.appendChild(folderHeader);

    const childUl = document.createElement("ul");
    childUl.className = "folder-children";
    if (!isExpanded) {
      childUl.classList.add("collapsed");
    }

    for (const child of node.children) {
      childUl.appendChild(
        renderNode(child, depth + 1, [...folderChain, node.title], keywordsMap),
      );
    }

    li.appendChild(childUl);
  } else {
    const bookmarkRow = document.createElement("div");
    bookmarkRow.className = "bookmark-row";
    bookmarkRow.style.paddingLeft = `${depth * 20}px`;
    const tooltipParts: string[] = [];
    if (node.title) tooltipParts.push(node.title);
    if (node.url) tooltipParts.push(node.url);
    bookmarkRow.setAttribute("title", tooltipParts.join("\n") || "");
    bookmarkRow.setAttribute("draggable", "true");

    bookmarkRow.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", node.id);
      e.dataTransfer!.effectAllowed = "move";
      bookmarkRow.classList.add("dragging");
    });

    bookmarkRow.addEventListener("dragend", () => {
      bookmarkRow.classList.remove("dragging");
    });

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

    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.innerHTML = "&#9998;";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleNodeEdit(node);
    });
    bookmarkRow.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerHTML = "&#10005;";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleNodeDelete(node);
    });
    bookmarkRow.appendChild(deleteBtn);

    const allKeywords = keywordsMap.get(node.id) ?? [];
    if (allKeywords.length > 0) {
      const keywordsEl = document.createElement("div");
      keywordsEl.className = "bookmark-keywords";
      for (const kw of allKeywords) {
        const tag = document.createElement("span");
        tag.className = "keyword-tag";
        tag.textContent = kw;
        keywordsEl.appendChild(tag);
      }
      bookmarkRow.appendChild(keywordsEl);
    }

    bookmarkRow.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("delete-btn")) return;
      if ((e.target as HTMLElement).classList.contains("edit-btn")) return;
      handleNodeClick(node);
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
}

function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return "";
  }
}

function handleNodeClick(node: chrome.bookmarks.BookmarkTreeNode) {
  if (node.url) {
    window.open(node.url, "_blank");
  }
}

async function handleNodeDelete(node: chrome.bookmarks.BookmarkTreeNode) {
  if (node.url) {
    await chrome.bookmarks.remove(node.id);
  } else {
    await chrome.bookmarks.removeTree(node.id);
  }

  showToast(
    `Deleted "${(node.title || node.url || "").slice(0, 30)}". `,
    5000,
    () => restore(node, node.parentId!),
  );
}

async function handleNodeEdit(node: chrome.bookmarks.BookmarkTreeNode) {
  const changes: { title?: string; url?: string } = {};

  const newTitle = prompt("Edit title:", node.title);
  if (newTitle === null) return;
  else if (newTitle !== node.title) changes.title = newTitle;

  if (node.url) {
    const newUrl = prompt("Edit URL:", node.url);
    if (newUrl === null) return;
    else if (newUrl !== node.url) changes.url = newUrl;
  }

  if (Object.keys(changes).length > 0) {
    await chrome.bookmarks.update(node.id, changes);
  }
}

async function handleNodeMove(bookmarkId: string, newParentId: string) {
  await chrome.bookmarks.move(bookmarkId, { parentId: newParentId });
}

async function restore(
  node: chrome.bookmarks.BookmarkTreeNode,
  parentId: string,
) {
  const restored = await chrome.bookmarks.create({
    title: node.title,
    ...(node.url ? { url: node.url } : {}),
    parentId,
    index: node.index,
  });

  if (node.children) {
    await Promise.all(node.children.map((c) => restore(c, restored.id)));
  }
}
