import { HDBSCAN } from "hdbscan-ts";
import * as db from "../shared/db";

const MIN_CLUSTER_SIZE = 3;
const MAX_CLUSTER_COUNT = 8;
const MAX_ITERATIONS = 30;

export const clusteringAlgorithms = [
  { id: "spherical-kmeans", label: "Spherical K-means" },
  { id: "agglomerative", label: "Agglomerative" },
  { id: "hdbscan", label: "HDBSCAN" },
  { id: "dbscan", label: "DBSCAN" },
  { id: "spectral", label: "Spectral" },
  { id: "gaussian-mixture", label: "Gaussian mixture" },
  { id: "graph-communities", label: "Graph communities" },
  { id: "nmf", label: "NMF topics" },
  { id: "lda", label: "LDA topics" },
] as const;

export type ClusteringAlgorithm = (typeof clusteringAlgorithms)[number]["id"];

export interface ClusterBookmark {
  id: string;
  title: string;
  url: string;
  score?: number;
}

export interface ClusterGroup {
  label: string;
  bookmarks: ClusterBookmark[];
  terms: string[];
}

export interface ClusteringResult {
  algorithm: ClusteringAlgorithm;
  clusters: ClusterGroup[];
  noise: ClusterBookmark[];
  summary: {
    bookmarkCount: number;
    clusteredCount: number;
    noiseCount: number;
  };
}

interface Dataset {
  bookmarks: db.BookmarkRecord[];
  vocabulary: string[];
  vectors: number[][];
  excluded: ClusterBookmark[];
}

/** Run a selected algorithm against the latest cached TF-IDF vectors. */
export async function clusterBookmarks(
  algorithm: ClusteringAlgorithm,
): Promise<ClusteringResult> {
  const dataset = await getDataset();
  const assignments = dataset.vectors.length
    ? cluster(algorithm, dataset.vectors, dataset.bookmarks, dataset.vocabulary)
    : [];
  const result = toResult(algorithm, dataset, assignments);
  console.log(`[Pebble] ${algorithm} bookmark clusters`, result);
  return result;
}

/** Preserve the original new-tab diagnostic behaviour. */
export async function runClustering(): Promise<void> {
  await clusterBookmarks("hdbscan");
}

async function getDataset(): Promise<Dataset> {
  const allBookmarks = await db.getAllBookmarks();
  const bookmarks = allBookmarks.filter(
    (bookmark) => bookmark.url && hasUsableScores(bookmark.wordScores),
  );
  const vocabulary = [
    ...new Set(bookmarks.flatMap((b) => Object.keys(b.wordScores))),
  ].sort();
  return {
    bookmarks,
    vocabulary,
    vectors: bookmarks.map((bookmark) =>
      normalize(vocabulary.map((term) => bookmark.wordScores[term] ?? 0)),
    ),
    excluded: allBookmarks
      .filter(
        (bookmark) => bookmark.url && !hasUsableScores(bookmark.wordScores),
      )
      .map(toBookmark),
  };
}

function hasUsableScores(scores: Record<string, number>): boolean {
  return Object.values(scores).some(
    (score) => Number.isFinite(score) && score > 0,
  );
}

function cluster(
  algorithm: ClusteringAlgorithm,
  vectors: number[][],
  bookmarks: db.BookmarkRecord[],
  vocabulary: string[],
): number[] {
  if (vectors.length < MIN_CLUSTER_SIZE) return vectors.map(() => -1);
  const count = clusterCount(vectors.length);
  switch (algorithm) {
    case "spherical-kmeans":
      return sphericalKMeans(vectors, count).assignments;
    case "agglomerative":
      return agglomerative(vectors, count);
    case "hdbscan":
      return hdbscan(vectors);
    case "dbscan":
      return dbscan(vectors);
    case "spectral":
      return spectral(vectors, count);
    case "gaussian-mixture":
      return gaussianMixture(vectors, count);
    case "graph-communities":
      return graphCommunities(vectors);
    case "nmf":
      return nmf(vectors, count);
    case "lda":
      return lda(bookmarks, vocabulary, count);
  }
}

function clusterCount(length: number): number {
  return Math.max(
    2,
    Math.min(MAX_CLUSTER_COUNT, Math.round(Math.sqrt(length))),
  );
}

function sphericalKMeans(vectors: number[][], count: number) {
  let centroids = Array.from(
    { length: count },
    (_, index) => vectors[index % vectors.length],
  );
  let assignments = vectors.map(() => 0);
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const next = vectors.map((vector) => nearestCentroid(vector, centroids));
    if (
      iteration > 0 &&
      next.every((value, index) => value === assignments[index])
    )
      break;
    assignments = next;
    centroids = centroids.map((centroid, cluster) => {
      const members = vectors.filter(
        (_, index) => assignments[index] === cluster,
      );
      return members.length ? normalize(mean(members)) : centroid;
    });
  }
  return { assignments, centroids };
}

function agglomerative(vectors: number[][], count: number): number[] {
  const groups = vectors.map((_, index) => [index]);
  while (groups.length > count) {
    let bestLeft = 0;
    let bestRight = 1;
    let bestDistance = Infinity;
    for (let left = 0; left < groups.length; left++) {
      for (let right = left + 1; right < groups.length; right++) {
        const distance = averageDistance(groups[left], groups[right], vectors);
        if (distance < bestDistance)
          [bestLeft, bestRight, bestDistance] = [left, right, distance];
      }
    }
    groups[bestLeft].push(...groups[bestRight]);
    groups.splice(bestRight, 1);
  }
  return labelsFromGroups(groups, vectors.length);
}

function hdbscan(vectors: number[][]): number[] {
  const model = new HDBSCAN({
    minClusterSize: MIN_CLUSTER_SIZE,
    minSamples: MIN_CLUSTER_SIZE,
    debugMode: false,
  });
  return model.fit(vectors);
}

function dbscan(vectors: number[][]): number[] {
  const labels = vectors.map(() => -2);
  let label = 0;
  for (let index = 0; index < vectors.length; index++) {
    if (labels[index] !== -2) continue;
    const neighbors = epsilonNeighbors(index, vectors, 0.45);
    if (neighbors.length < MIN_CLUSTER_SIZE) {
      labels[index] = -1;
      continue;
    }
    labels[index] = label;
    for (let cursor = 0; cursor < neighbors.length; cursor++) {
      const neighbor = neighbors[cursor];
      if (labels[neighbor] === -1) labels[neighbor] = label;
      if (labels[neighbor] !== -2) continue;
      labels[neighbor] = label;
      const expanded = epsilonNeighbors(neighbor, vectors, 0.45);
      if (expanded.length >= MIN_CLUSTER_SIZE) {
        for (const candidate of expanded)
          if (!neighbors.includes(candidate)) neighbors.push(candidate);
      }
    }
    label++;
  }
  return labels;
}

function spectral(vectors: number[][], count: number): number[] {
  const affinity = vectors.map((vector, index) =>
    vectors.map((other, otherIndex) =>
      index === otherIndex || cosine(vector, other) >= 0.2
        ? Math.max(0, cosine(vector, other))
        : 0,
    ),
  );
  const degrees = affinity.map(
    (row) => Math.sqrt(row.reduce((sum, value) => sum + value, 0)) || 1,
  );
  const normalized = affinity.map((row, i) =>
    row.map((value, j) => value / (degrees[i] * degrees[j])),
  );
  const embedding = Array.from(
    { length: vectors.length },
    () => [] as number[],
  );
  let basis: number[][] = [];
  for (let component = 0; component < count; component++) {
    let vector = normalized.map(
      (_, index) => ((index + component + 1) % 7) + 1,
    );
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      vector = multiplyMatrix(normalized, vector);
      for (const prior of basis)
        vector = subtract(vector, scale(prior, dot(vector, prior)));
      vector = normalize(vector);
    }
    basis.push(vector);
    vector.forEach((value, index) => embedding[index].push(value));
  }
  return sphericalKMeans(embedding.map(normalize), count).assignments;
}

function gaussianMixture(vectors: number[][], count: number): number[] {
  const initial = sphericalKMeans(vectors, count);
  let means = initial.centroids;
  let variances = means.map(() => 0.05);
  let weights = means.map(() => 1 / count);
  let responsibilities = vectors.map(() => means.map(() => 1 / count));
  for (let iteration = 0; iteration < 12; iteration++) {
    responsibilities = vectors.map((vector) => {
      const scores = means.map(
        (meanVector, index) =>
          weights[index] *
          Math.exp(-cosineDistance(vector, meanVector) / variances[index]),
      );
      const total = scores.reduce((sum, score) => sum + score, 0) || 1;
      return scores.map((score) => score / total);
    });
    means = means.map((meanVector, cluster) => {
      const total =
        responsibilities.reduce((sum, row) => sum + row[cluster], 0) || 1;
      return normalize(
        meanVector.map(
          (_, dimension) =>
            responsibilities.reduce(
              (sum, row, index) =>
                sum + row[cluster] * vectors[index][dimension],
              0,
            ) / total,
        ),
      );
    });
    weights = means.map(
      (_, cluster) =>
        responsibilities.reduce((sum, row) => sum + row[cluster], 0) /
        vectors.length,
    );
    variances = means.map((meanVector, cluster) =>
      Math.max(
        0.01,
        responsibilities.reduce(
          (sum, row, index) =>
            sum + row[cluster] * cosineDistance(vectors[index], meanVector),
          0,
        ) / (weights[cluster] * vectors.length || 1),
      ),
    );
  }
  return responsibilities.map((row) => maxIndex(row));
}

function graphCommunities(vectors: number[][]): number[] {
  const neighbors = vectors.map((vector, index) =>
    vectors
      .map((other, otherIndex) => ({
        otherIndex,
        similarity: index === otherIndex ? -1 : cosine(vector, other),
      }))
      .filter(({ similarity }) => similarity >= 0.25)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, 8),
  );
  const labels = vectors.map((_, index) => index);
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let changed = false;
    for (let index = 0; index < labels.length; index++) {
      const scores = new Map<number, number>();
      for (const neighbor of neighbors[index])
        scores.set(
          labels[neighbor.otherIndex],
          (scores.get(labels[neighbor.otherIndex]) ?? 0) + neighbor.similarity,
        );
      if (!scores.size) continue;
      const next = [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
      if (next !== labels[index]) [labels[index], changed] = [next, true];
    }
    if (!changed) break;
  }
  return compactLabels(labels, MIN_CLUSTER_SIZE);
}

function nmf(vectors: number[][], count: number): number[] {
  const documents = vectors.length;
  const terms = vectors[0].length;
  let weights = Array.from({ length: documents }, (_, i) =>
    Array.from({ length: count }, (_, k) => ((i + k) % count) + 0.1),
  );
  let topics = Array.from({ length: count }, (_, k) =>
    Array.from({ length: terms }, (_, j) => ((k + j) % 5) + 0.1),
  );
  for (let iteration = 0; iteration < 20; iteration++) {
    const wh = multiply(weights, topics);
    weights = weights.map((row, i) =>
      row.map(
        (value, k) =>
          value * (dot(vectors[i], topics[k]) / (dot(wh[i], topics[k]) + 1e-9)),
      ),
    );
    const whAfterWeights = multiply(weights, topics);
    topics = topics.map((topic, k) =>
      topic.map(
        (value, j) =>
          value *
          (weights.reduce((sum, row, i) => sum + row[k] * vectors[i][j], 0) /
            (weights.reduce(
              (sum, row, i) => sum + row[k] * whAfterWeights[i][j],
              0,
            ) +
              1e-9)),
      ),
    );
  }
  return weights.map(maxIndex);
}

function lda(
  bookmarks: db.BookmarkRecord[],
  vocabulary: string[],
  count: number,
): number[] {
  const termIndex = new Map(vocabulary.map((term, index) => [term, index]));
  const documents = bookmarks.map((bookmark) =>
    Object.entries(bookmark.wordScores).flatMap(([term, score]) =>
      Array(Math.max(1, Math.round(score * 100))).fill(termIndex.get(term)!),
    ),
  );
  const assignments = documents.map((words, document) =>
    words.map((_, word) => (word + document) % count),
  );
  const documentTopics = documents.map(() => Array(count).fill(0));
  const topicTerms = Array.from({ length: count }, () =>
    Array(vocabulary.length).fill(0),
  );
  const topicTotals = Array(count).fill(0);
  const update = (
    document: number,
    word: number,
    topic: number,
    delta: number,
  ) => {
    documentTopics[document][topic] += delta;
    topicTerms[topic][word] += delta;
    topicTotals[topic] += delta;
  };
  assignments.forEach((topics, document) =>
    topics.forEach((topic, word) =>
      update(document, documents[document][word], topic, 1),
    ),
  );
  for (let iteration = 0; iteration < 25; iteration++) {
    assignments.forEach((topics, document) =>
      topics.forEach((topic, wordPosition) => {
        const word = documents[document][wordPosition];
        update(document, word, topic, -1);
        const probabilities = topicTotals.map(
          (total, candidate) =>
            ((documentTopics[document][candidate] + 0.1) *
              (topicTerms[candidate][word] + 0.01)) /
            (total + vocabulary.length * 0.01),
        );
        const next = maxIndex(probabilities);
        assignments[document][wordPosition] = next;
        update(document, word, next, 1);
      }),
    );
  }
  return documentTopics.map(maxIndex);
}

function toResult(
  algorithm: ClusteringAlgorithm,
  dataset: Dataset,
  assignments: number[],
): ClusteringResult {
  const groups = new Map<number, db.BookmarkRecord[]>();
  const noise = [...dataset.excluded];
  assignments.forEach((assignment, index) => {
    if (assignment < 0) noise.push(toBookmark(dataset.bookmarks[index]));
    else
      groups.set(assignment, [
        ...(groups.get(assignment) ?? []),
        dataset.bookmarks[index],
      ]);
  });
  const clusters = [...groups.entries()]
    .filter(
      ([, bookmarks]) =>
        bookmarks.length >=
        (algorithm === "graph-communities" ? MIN_CLUSTER_SIZE : 1),
    )
    .sort(([left], [right]) => left - right)
    .map(([label, bookmarks]) => ({
      label: `Cluster ${label + 1}`,
      bookmarks: bookmarks.map(toBookmark),
      terms: topTerms(bookmarks, dataset.vocabulary),
    }));
  const smallGroups = [...groups.entries()].filter(
    ([, bookmarks]) =>
      bookmarks.length <
      (algorithm === "graph-communities" ? MIN_CLUSTER_SIZE : 1),
  );
  smallGroups.forEach(([, bookmarks]) =>
    noise.push(...bookmarks.map(toBookmark)),
  );
  return {
    algorithm,
    clusters,
    noise,
    summary: {
      bookmarkCount: dataset.bookmarks.length + dataset.excluded.length,
      clusteredCount: clusters.reduce(
        (sum, group) => sum + group.bookmarks.length,
        0,
      ),
      noiseCount: noise.length,
    },
  };
}

function topTerms(
  bookmarks: db.BookmarkRecord[],
  vocabulary: string[],
): string[] {
  return vocabulary
    .map((term) => ({
      term,
      score:
        bookmarks.reduce(
          (sum, bookmark) => sum + (bookmark.wordScores[term] ?? 0),
          0,
        ) / bookmarks.length,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map(({ term }) => term);
}

function toBookmark(bookmark: db.BookmarkRecord): ClusterBookmark {
  return { id: bookmark.id, title: bookmark.title, url: bookmark.url };
}

function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(dot(vector, vector));
  return magnitude ? vector.map((value) => value / magnitude) : vector;
}
function cosine(left: number[], right: number[]): number {
  return dot(left, right);
}
function cosineDistance(left: number[], right: number[]): number {
  return 1 - cosine(left, right);
}
function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}
function mean(vectors: number[][]): number[] {
  return vectors[0].map(
    (_, index) =>
      vectors.reduce((sum, vector) => sum + vector[index], 0) / vectors.length,
  );
}
function nearestCentroid(vector: number[], centroids: number[][]): number {
  return maxIndex(centroids.map((centroid) => cosine(vector, centroid)));
}
function maxIndex(values: number[]): number {
  return values.reduce(
    (best, value, index) => (value > values[best] ? index : best),
    0,
  );
}
function scale(vector: number[], scalar: number): number[] {
  return vector.map((value) => value * scalar);
}
function subtract(left: number[], right: number[]): number[] {
  return left.map((value, index) => value - right[index]);
}
function multiplyMatrix(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => dot(row, vector));
}
function multiply(left: number[][], right: number[][]): number[][] {
  return left.map((row) =>
    right[0].map((_, column) =>
      row.reduce((sum, value, index) => sum + value * right[index][column], 0),
    ),
  );
}
function averageDistance(
  left: number[],
  right: number[],
  vectors: number[][],
): number {
  return (
    left.reduce(
      (sum, a) =>
        sum +
        right.reduce(
          (inner, b) => inner + cosineDistance(vectors[a], vectors[b]),
          0,
        ),
      0,
    ) /
    (left.length * right.length)
  );
}
function labelsFromGroups(groups: number[][], length: number): number[] {
  const labels = Array(length).fill(-1);
  groups.forEach((group, label) =>
    group.forEach((index) => (labels[index] = label)),
  );
  return labels;
}
function epsilonNeighbors(
  index: number,
  vectors: number[][],
  epsilon: number,
): number[] {
  return vectors.flatMap((vector, candidate) =>
    cosineDistance(vectors[index], vector) <= epsilon ? [candidate] : [],
  );
}
function compactLabels(labels: number[], minSize: number): number[] {
  const counts = new Map<number, number>();
  labels.forEach((label) => counts.set(label, (counts.get(label) ?? 0) + 1));
  const map = new Map<number, number>();
  let next = 0;
  return labels.map((label) => {
    if ((counts.get(label) ?? 0) < minSize) return -1;
    if (!map.has(label)) map.set(label, next++);
    return map.get(label)!;
  });
}
