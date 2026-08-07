# Feature Spec: Force-Directed Bookmark Graph

## Objective

Add an interactive network visualization that lets users explore relationships
between bookmarks and the clusters produced by the selected clustering
algorithm.

## Visualization Model

- Each bookmark is a graph node.
- Nodes are colored by the currently selected clustering algorithm's cluster.
- Bookmarks marked as noise or unclustered use a neutral color.
- Edges represent meaningful TF-IDF cosine-similarity relationships.
- Edge opacity and width convey relative similarity strength.
- Optional node sizing may represent graph centrality or bookmark metadata when
  that metadata becomes available.

A force simulation positions the graph: nodes repel one another, edges pull
related nodes together, and a centering force keeps the network in view. The
expected outcome is visually separated islands of related bookmarks.

## Graph Construction

The graph must remain sparse. It must not connect every pair of bookmarks.

1. Read the existing normalized TF-IDF vectors.
2. Calculate cosine similarity for candidate bookmark pairs.
3. For each bookmark, retain its three to eight nearest neighbors.
4. Omit edges below a configurable similarity threshold, initially in the
   `0.20` to `0.35` range.
5. Deduplicate reciprocal neighbor edges.
6. Use this k-nearest-neighbor graph as both the visualization input and the
   source graph for graph-community clustering where applicable.

## Interactions

- Hovering a node reveals its title, URL, assigned cluster, and strongest
  terms.
- Clicking a node opens its bookmark in a new tab.
- Dragging a node temporarily pins it for inspection.
- Users can pan and zoom the graph.
- A cluster legend can highlight or filter a selected cluster.
- Search can focus a bookmark and its immediate neighbors.
- Users can hide weak edges or show only the selected bookmark's neighborhood.

## Rendering Technology

Use `d3-force` with Canvas rendering as the default technical direction.
Canvas has acceptable performance for hundreds to low thousands of bookmarks,
while retaining custom control over styling and interactions. SVG is acceptable
only for small collections. Cytoscape.js and Sigma.js are alternatives if
advanced graph tooling or substantially larger graphs become requirements.

## Performance and Stability

- Seed initial node positions deterministically from bookmark IDs so the graph
  does not change needlessly between page loads.
- Cap force-simulation iterations and stop it once movement falls below a
  small threshold.
- Build and simulate the graph off the main UI path; use a Web Worker if
  collection size makes page interaction noticeably slow.
- Render the sparse nearest-neighbor graph only.
- Provide a fallback message when too few indexed bookmarks have usable
  TF-IDF vectors or no edges meet the threshold.

## Non-Goals

- This feature does not replace the bookmark tree or the existing cluster-card
  views.
- Graph coordinates and interaction state are not persisted initially.
- Force-layout proximity is exploratory and must not be presented as a precise
  distance-preserving embedding.
- This specification does not require implementation of a dimensionality
  reduction plot such as UMAP or t-SNE.

## Acceptance Criteria

- A graph view clearly distinguishes bookmarks, similarity edges, clusters,
  and unclustered bookmarks.
- The graph remains readable by limiting edges to thresholded nearest
  neighbors.
- Hover, click, drag, pan, and zoom work without affecting the existing
  bookmark views.
- The layout is reasonably stable across equivalent runs.
- Large bookmark collections do not noticeably block the new-tab interface.
