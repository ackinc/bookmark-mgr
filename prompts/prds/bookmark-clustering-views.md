# Feature Spec: Bookmark Clustering Views

## Objective

Let a user switch between the existing bookmark-tree view and several on-demand
views that group indexed bookmarks by their TF-IDF similarity.

## User Experience

- The bookmark tree remains the selected default whenever a new tab opens.
- A left sidebar provides a **Bookmarks** option plus one option for each
  clustering algorithm.
- Selecting an algorithm computes its groups in the new-tab page, writes the
  structured result to the developer console, and replaces the main content
  with read-only cluster cards.
- A card shows its numbered cluster, its four strongest TF-IDF terms, and links
  to its bookmarks. Bookmarks that cannot be assigned are shown under
  **Unclustered**.
- Returning to **Bookmarks** restores the existing editable, draggable tree.
- The selected view is session-only; it is not persisted.

## Data and Preparation

1. Read bookmark records from IndexedDB at selection time.
2. Include URL-bearing records whose `wordScores` contain a finite positive
   value. Report all other URL-bearing records as unclustered.
3. Form a deterministic alphabetically sorted vocabulary from score keys.
4. Produce dense TF-IDF vectors in vocabulary order and L2-normalize them.
   Cosine similarity is then the dot product of two vectors.
5. Run all computation in the new-tab document. No cluster assignments are
   stored in IndexedDB.

## Algorithms

Each sidebar option has a local browser implementation appropriate for the
small to medium bookmark collections expected on a new-tab page:

| View              | Implementation and output                                                     |
| ----------------- | ----------------------------------------------------------------------------- |
| Spherical K-means | Cosine-based centroid clustering; cluster count is derived from corpus size.  |
| Agglomerative     | Average-linkage hierarchy cut at the derived cluster count.                   |
| HDBSCAN           | `hdbscan-ts` density clustering, with three minimum samples per cluster.      |
| DBSCAN            | Cosine-distance density clustering with a fixed exploratory radius.           |
| Spectral          | Normalized affinity-matrix embedding followed by spherical K-means.           |
| Gaussian mixture  | Expectation-maximization with cosine-distance component likelihoods.          |
| Graph communities | Similarity k-nearest-neighbor graph and weighted label propagation.           |
| NMF topics        | Non-negative matrix factorization; an article belongs to its strongest topic. |
| LDA topics        | Collapsed-Gibbs topic assignment over weighted TF-IDF terms.                  |

The automatic cluster count is bounded between two and eight. Algorithms that
naturally discover groups can return fewer groups or noise. Fewer than three
usable bookmarks produce only unclustered results.

## Console and Failure Behaviour

- Every clustering request logs one structured result prefixed with
  `[Pebble] <algorithm> bookmark clusters`.
- The result contains the algorithm ID, groups, group terms, unclustered
  bookmarks, and summary counts.
- Failures are caught, logged with `console.error`, and rendered as a concise
  failure message without affecting bookmark-tree rendering or reconciliation.

## Non-Goals

- No dimensionality-reduction visualization, graph canvas, or persisted
  settings.
- No automatic recomputation while a clustering view remains open after an
  index update; the active view is recomputed when the update renders.
- No parameter controls or claims that graph label propagation is a full
  Leiden/Louvain implementation.

## Acceptance Criteria

- New tabs initially show the unchanged bookmark tree.
- The sidebar exposes all nine listed algorithms and the default tree view.
- Each algorithm can render groups for valid indexed bookmark data and log its
  result without blocking the page.
- Each group provides descriptive terms and working bookmark links.
- Bookmarks lacking usable TF-IDF scores remain visible as unclustered.
- `pnpm typecheck` and `pnpm build` succeed.
