# PRD: TF-IDF Bookmark Vectors

## Original Prompt

> I want to use tf-idf to generate a vector for each bookmark that I can later use to cluster bookmarks.
>
> We can do this by adding a new "words" store to the pebble indexeddb, which will have an entry for each unique word across all bookmarks. Each entry will carry the word itself (which doubles as the unique identifier), the list of bookmarks (represented by their ids) it appears in, and that word's idf score
>
> In addition to this, we will introduce new data to the "bookmarks" store - a field called word_scores that is a record mapping each word that is associated with the bookmark to that word's tf-idf score for that bookmark
>
> Create the specification document for this feature, and put it (along with this prompt) in prompts/prds/tf-idf.md

## Overview

Extend Pebble's background indexing pipeline to calculate a sparse TF-IDF vector for every indexed bookmark. Persist the corpus vocabulary and inverse-document-frequency values in a new IndexedDB `words` object store, and persist each bookmark's vector in `bookmarks.word_scores`.

This feature supplies clustering-ready data only. Selecting or implementing a clustering algorithm is out of scope.

## Goals

- Maintain one vocabulary entry for every unique word associated with at least one bookmark.
- Maintain a deterministic TF-IDF score for every bookmark-word association.
- Keep `words` postings, IDF values, and bookmark vectors consistent when bookmarks are created, changed, moved, removed, or fully reconciled.
- Make vectors directly consumable as sparse records without requiring callers to repeat corpus-wide calculations.
- Perform all indexing locally, with no network service or backend.

## Non-Goals

- Clustering bookmarks or choosing a clustering algorithm.
- Rendering vectors, clusters, or word scores in the new-tab UI.
- Stemming, lemmatization, synonyms, embeddings, or semantic enrichment.
- Changing the current keyword extraction and normalization rules.
- Storing dense vectors with a fixed coordinate order.

## Terminology and Corpus

- A **document** is one URL-bearing bookmark in the IndexedDB `bookmarks` store. Folders are excluded.
- A **word** is one value in a bookmark's existing deduplicated `keywords` array. The existing extraction pipeline remains the source of token normalization, stop-word removal, URL terms, and folder-derived terms.
- The **corpus** is the complete set of documents currently in the `bookmarks` store.
- `N` is the number of documents in the corpus.
- `df(w)` is the number of distinct bookmarks whose `keywords` contain word `w`.

Because `keywords` is deduplicated and does not preserve occurrence counts, this feature uses normalized binary term frequency:

```text
tf(w, b) = 1 / |keywords(b)|, when w is associated with b
tf(w, b) = 0, otherwise
```

Use smoothed inverse document frequency so scores remain defined for every valid corpus size and ubiquitous words retain a nonzero coordinate:

```text
idf(w) = ln((N + 1) / (df(w) + 1)) + 1
score(w, b) = tf(w, b) * idf(w)
```

Use JavaScript's natural logarithm (`Math.log`) and store full-precision finite numbers. A bookmark with no keywords has an empty vector. An empty corpus has no `words` records.

## Data Model

### IndexedDB migration

- Increment the `pebble` database version from `1` to `2`.
- During `onupgradeneeded`, create a `words` object store if it does not exist.
- Use `word` as the store's key path; no secondary indexes are required.
- Preserve existing `bookmarks` and `meta` records during migration.
- Existing bookmark records may initially lack `word_scores`; readers must treat a missing field as `{}` until the first successful TF-IDF rebuild.
- Trigger a full index reconciliation/rebuild after upgrading so existing installations are backfilled.

### `words` store

```ts
interface WordRecord {
  word: string;
  bookmark_ids: string[];
  idf: number;
}
```

Requirements:

- `word` is both the term and the unique primary key.
- `bookmark_ids` contains each associated bookmark ID exactly once, sorted lexicographically for deterministic persistence.
- `idf` follows the formula above and is recalculated against the current complete corpus.
- A record must be deleted when its `bookmark_ids` becomes empty.

### `bookmarks` store addition

```ts
interface BookmarkRecord {
  // Existing fields omitted.
  word_scores: Record<string, number>;
}
```

Requirements:

- `word_scores` is a sparse vector whose keys exactly match the bookmark's unique `keywords` values.
- Each value is the bookmark-word TF-IDF score defined above.
- `word_scores` is `{}` when the bookmark has no keywords.
- Normal bookmark upserts that are unrelated to keyword extraction must preserve the existing `word_scores` value until a rebuild replaces it.
- New records should default `word_scores` to `{}` if vector calculation is not part of the same operation.
- Word keys are ordinary object keys. Build records with a null prototype, or otherwise assign keys safely, so extracted values such as `__proto__` cannot mutate the record prototype.

## Functional Requirements

### 1. Corpus rebuild

Provide one background-indexing operation that rebuilds all TF-IDF data from the current `bookmarks` records:

1. Read every bookmark record after pending bookmark keyword upserts and stale-record removals have completed.
2. Build an in-memory posting set from each bookmark's unique `keywords`.
3. Calculate `N`, every word's `df`, and every word's `idf`.
4. Calculate a complete `word_scores` record for each bookmark.
5. In one read-write transaction spanning `bookmarks` and `words`:
   - update every bookmark's `word_scores` without changing its other fields;
   - clear obsolete `words` records; and
   - write the complete current set of `WordRecord` values.
6. Resolve only when the transaction completes; reject on request or transaction failure.

Replacing the `words` store contents during a rebuild is acceptable. The expected corpus is small, and a full calculation avoids incremental IDF errors: adding or removing one document changes `N` and can therefore change every word's IDF and every bookmark vector.

### 2. Indexing lifecycle integration

- Run the rebuild after a successful full bookmark reconciliation.
- Run the rebuild after processing a bookmark or folder create, change, move, or removal event when that operation changes indexed bookmark records.
- A folder rename or move must first re-extract affected descendant bookmark keywords, then rebuild vectors.
- Do not broadcast an index update until the bookmark mutation and TF-IDF rebuild have both completed successfully.
- Coalesce or serialize overlapping rebuild requests so two service-worker tasks cannot commit calculations based on different corpus snapshots. If the corpus changes during a rebuild, queue one subsequent rebuild against the latest state.
- An aborted or failed reconciliation must not start a rebuild from partial reconciliation output.

### 3. Database API

The shared database module must expose typed operations sufficient to:

- read one or all word records;
- retrieve bookmark vectors through the existing bookmark reads; and
- atomically replace the corpus's word records and bookmark `word_scores` values.

Consumers must not write one store independently when doing so could expose mismatched IDF values and vectors.

### 4. Determinism and validation

- Deduplicate each bookmark's keywords defensively before calculating document frequency or term frequency.
- Ignore invalid keyword values that are not nonempty strings if malformed legacy data is encountered.
- Sort words before constructing persisted `word_scores` records and sort `bookmark_ids` before writing word records.
- Never persist `NaN`, `Infinity`, or negative scores.
- Given the same bookmark IDs and keyword arrays, repeated rebuilds must produce equivalent records.

## Data Consistency Invariants

After each successful rebuild:

1. A `words` record exists if and only if at least one bookmark is associated with that word.
2. `words[word].bookmark_ids` equals the set of bookmark IDs whose `word_scores` contains `word`.
3. Every `word_scores` key has a corresponding `words` record.
4. Every score equals `idf(word) / uniqueKeywordCount(bookmark)` within normal floating-point precision.
5. No removed bookmark ID remains in any `bookmark_ids` list.
6. The database never exposes a committed state containing newly calculated word records with stale bookmark vectors, or vice versa.

## Failure and Recovery

- A failed atomic rebuild leaves the previously committed vectors and vocabulary unchanged.
- Persist a TF-IDF calculation version in `meta` (initial value `1`). A missing or older version marks the derived data as stale and requests a full rebuild on the next index check.
- Update the stored calculation version only inside the successful rebuild transaction.
- If the MV3 service worker terminates before commit, the next activation/index check retries because the calculation version remains stale.
- Log rebuild failures without deleting otherwise valid bookmark metadata.

## Performance Expectations

- Build postings and vectors in memory in `O(K)` time, where `K` is the total number of unique bookmark-word associations.
- Use a constant number of IndexedDB transactions for a rebuild rather than opening one transaction per word or bookmark.
- The feature must support at least 500 bookmarks without noticeably blocking new-tab rendering; calculation remains in the background service worker.
- New-tab startup must continue rendering from cached bookmark data and must not await a TF-IDF rebuild.

## Acceptance Criteria

1. Upgrading an existing database creates the `words` store without deleting existing bookmark or metadata records.
2. After reconciliation, each unique keyword has exactly one `words` record with the correct sorted bookmark IDs and IDF value.
3. Every bookmark has a `word_scores` sparse record with the correct TF-IDF value for each of its keywords.
4. Creating a bookmark updates the vocabulary, document frequencies, IDF values, and all affected vectors.
5. Renaming or moving a bookmark or parent folder removes obsolete associations and adds new ones after keyword re-extraction.
6. Removing a bookmark or folder removes its IDs from all postings, deletes orphaned words, and recalculates corpus-wide scores.
7. A bookmark with no valid keywords persists `word_scores: {}` and creates no word records.
8. Repeated rebuilds with unchanged inputs produce equivalent IndexedDB records.
9. Simulated transaction failure does not leave the two stores in a mismatched committed state.
10. `pnpm typecheck` and `pnpm build` pass.

## Verification Plan

- Unit-check the formula with a small fixture corpus containing shared, unique, ubiquitous, and zero-keyword bookmarks.
- Inspect IndexedDB after database migration and initial backfill.
- Exercise Chrome bookmark create, rename, move, folder rename/move, single removal, and folder-tree removal events.
- Verify service-worker restart recovery when derived data is marked stale.
- Verify no-op rebuild determinism and behavior with malformed or duplicate legacy keywords.
- Load `dist/` as an unpacked extension and confirm the new-tab page remains responsive while a rebuild runs.
