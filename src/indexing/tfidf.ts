/// <reference types="chrome" />

import * as db from "../shared/db";

/**
 * Build TF-IDF vectors for all bookmarks and persist them atomically
 * alongside the complete words vocabulary.
 */
export async function rebuildTfidf(): Promise<void> {
  const bookmarks = await db.getAllBookmarks();

  // Filter to URL-bearing bookmarks only (folders have no url)
  const documents = bookmarks.filter((b) => b.url);
  const N = documents.length;

  // Build postings: word -> Set of bookmark IDs
  const postings = new Map<string, Set<string>>();
  for (const bookmark of documents) {
    const uniqueKeywords = deduplicateAndValidate(bookmark.keywords);
    for (const word of uniqueKeywords) {
      let set = postings.get(word);
      if (!set) {
        set = new Set();
        postings.set(word, set);
      }
      set.add(bookmark.id);
    }
  }

  // Calculate IDF for each word: idf(w) = ln((N + 1) / (df(w) + 1)) + 1
  const idfMap = new Map<string, number>();
  for (const [word, bookmarkIds] of postings) {
    const df = bookmarkIds.size;
    const idf = Math.log(N / df);
    idfMap.set(word, idf);
  }

  // Calculate word_scores for each bookmark
  // tf(w, b) = 1 / |keywords(b)| when w is in keywords(b)
  // score(w, b) = tf(w, b) * idf(w)
  const wordScoresByBookmarkId: Record<string, Record<string, number>> = {};
  for (const bookmark of documents) {
    const uniqueKeywords = deduplicateAndValidate(bookmark.keywords);
    const keywordCount = uniqueKeywords.length;
    const scores: Record<string, number> = Object.create(null);

    if (keywordCount > 0) {
      const tf = 1 / keywordCount;
      for (const word of uniqueKeywords) {
        const idf = idfMap.get(word);
        if (idf !== undefined) {
          const score = tf * idf;
          // Guard against NaN/Infinity/negative
          if (Number.isFinite(score) && score >= 0) {
            scores[word] = score;
          }
        }
      }
    }

    wordScoresByBookmarkId[bookmark.id] = scores;
  }

  // Build WordRecords with sorted bookmark_ids
  const words: db.WordRecord[] = [];
  const sortedWords = [...postings.keys()].sort();
  for (const word of sortedWords) {
    const bookmarkIds = postings.get(word)!;
    words.push({
      word,
      bookmark_ids: [...bookmarkIds].sort(),
      idf: idfMap.get(word)!,
    });
  }

  // Atomically persist both stores
  await db.rebuildTfidfVectors({ wordScoresByBookmarkId, words });
}

/**
 * Deduplicate keywords and filter out invalid entries.
 */
function deduplicateAndValidate(keywords: string[]): string[] {
  const valid = keywords.filter(
    (k): k is string => typeof k === "string" && k.length > 0,
  );
  return [...new Set(valid)].sort();
}
