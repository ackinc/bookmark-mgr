# Feature Spec: Bookmark Clustering with HDBSCAN

## Objective

Cluster indexed bookmarks whenever the new-tab page opens and print the results to the page's developer console.

## Scope

- Use the existing TF-IDF `wordScores` stored in IndexedDB.
- Run clustering in the new-tab page process.
- Log results only; no UI changes or persistence.
- Do not rerun clustering when bookmark updates arrive during the session.

## Dependency

Add `hdbscan-ts` as a runtime dependency. It is browser-compatible, typed, and has no transitive runtime dependencies.

## Startup Flow

1. Open the new-tab page.
2. Load and render bookmarks using the existing flow.
3. Read all bookmark records with `db.getAllBookmarks()`.
4. Build clustering input.
5. Run HDBSCAN once.
6. Log the results.
7. Continue the existing background reconciliation request.

Clustering failures must not prevent bookmark rendering or reconciliation.

## Input Preparation

1. Include URL-bearing bookmarks with at least one finite, positive `wordScores` value.
2. Build a deterministic vocabulary from the union of included bookmarks' score keys, sorted alphabetically.
3. Convert each sparse `wordScores` object into a dense vector following that vocabulary.
4. Preserve bookmark order so each HDBSCAN label maps back to the correct record.
5. Exclude bookmarks with empty vectors from computation and report them as noise.

No dimensionality reduction or vector persistence is required.

## HDBSCAN Configuration

```ts
{
  minClusterSize: 5,
  minSamples: 5,
  debugMode: false,
}
```

Use the library's Euclidean distance implementation. A label of `-1` represents noise.

If fewer than five usable bookmarks exist, skip HDBSCAN and report every bookmark as noise.

## Console Output

Produce one structured log entry:

```ts
console.log("[Pebble] Bookmark clusters", {
  clusters: [
    {
      label: 0,
      bookmarks: [
        {
          id: "123",
          title: "Example",
          url: "https://example.com",
          probability: 0.82,
        },
      ],
    },
  ],
  noise: [
    {
      id: "456",
      title: "Unclustered bookmark",
      url: "https://example.org",
    },
  ],
  summary: {
    bookmarkCount: 20,
    clusteredCount: 15,
    noiseCount: 5,
    clusterCount: 2,
  },
});
```

Cluster entries should be ordered by numeric label. Bookmark order should follow the input record order.

## Error Handling

- Catch database, vector-construction, and HDBSCAN errors.
- Log failures with `console.error("[Pebble] Bookmark clustering failed", error)`.
- Do not modify the rendered page or display an error toast.
- Handle zero, one, and insufficient usable bookmarks without invoking the library.

## Expected Changes

- `package.json` and lockfile: add `hdbscan-ts`.
- New clustering module under `src/indexing/` to prepare vectors and map results.
- `src/newtab/main.ts`: invoke clustering once during initialization.

No IndexedDB schema or extension permission changes are required.

## Acceptance Criteria

- Opening a new tab runs clustering exactly once.
- Existing bookmark rendering remains unchanged.
- HDBSCAN consumes the existing TF-IDF scores.
- The console contains clusters, noise bookmarks, probabilities, and summary counts.
- Empty or insufficient datasets are handled without exceptions.
- Clustering errors do not block the page.
- `pnpm typecheck` and `pnpm build` succeed.

## Out of Scope

- Displaying clusters in the UI.
- Persisting cluster assignments.
- Automatically rerunning after index updates.
- Web workers or performance optimization.
- User-configurable HDBSCAN parameters.
- Cluster naming or semantic summaries.
