/**
 * Real Repository Performance Benchmark
 *
 * Simulates realistic Git workflows using low-level repository operations
 * and measures performance of:
 * - Repository initialization
 * - Object storage (blobs, trees, commits)
 * - History traversal
 * - Reference operations
 *
 * Run with: pnpm start
 */

import { createMemoryHistory, FileMode, type History } from "@statewalker/vcs-core";

// ============================================================================
// Content Generation
// ============================================================================

const SAMPLE_CODE = `
// Sample source code file
export function processData(input: string): string {
  const lines = input.split('\\n');
  return lines
    .filter(line => line.trim().length > 0)
    .map(line => line.toUpperCase())
    .join('\\n');
}

export interface Config {
  debug: boolean;
  maxItems: number;
  outputPath: string;
}

export const defaultConfig: Config = {
  debug: false,
  maxItems: 100,
  outputPath: './output'
};
`.trim();

/**
 * Generate file content variations
 */
function generateContent(base: string, variant: number): string {
  return `${base}\n// Variant ${variant}\n// Generated: ${Date.now()}\n`;
}

// ============================================================================
// Benchmark Utilities
// ============================================================================

interface BenchmarkResult {
  name: string;
  timeMs: number;
  details?: string;
}

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function padLeft(str: string, len: number): string {
  return str.padStart(len);
}

const encoder = new TextEncoder();

/**
 * Create a commit with the given tree and parents
 */
async function createCommit(
  history: History,
  treeId: string,
  parents: string[],
  message: string,
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  return history.commits.store({
    tree: treeId,
    parents,
    author: {
      name: "Benchmark",
      email: "bench@example.com",
      timestamp,
      tzOffset: "+0000",
    },
    committer: {
      name: "Benchmark",
      email: "bench@example.com",
      timestamp,
      tzOffset: "+0000",
    },
    message,
  });
}

// ============================================================================
// Main Benchmark
// ============================================================================

console.log("=".repeat(80));
console.log("  Real Repository Performance Benchmark");
console.log("=".repeat(80));
console.log();

// Configuration
const FILE_COUNT = 100;
const COMMIT_COUNT = 20;

console.log(`Configuration:`);
console.log(`  Files per tree: ${FILE_COUNT}`);
console.log(`  Commits: ${COMMIT_COUNT}`);
console.log();

const results: BenchmarkResult[] = [];

// Initialize repository
console.log("Initializing repository...");
const history: History = createMemoryHistory();
await history.initialize();

console.log("-".repeat(80));
console.log("Running benchmarks...");
console.log("-".repeat(80));
console.log();

// 1. Store blobs
let startTime = performance.now();
const blobIds: string[] = [];
for (let i = 0; i < FILE_COUNT; i++) {
  const content = generateContent(SAMPLE_CODE, i);
  const blobId = await history.blobs.store([encoder.encode(content)]);
  blobIds.push(blobId);
}
results.push({
  name: "Store blobs",
  timeMs: performance.now() - startTime,
  details: `${FILE_COUNT} blobs`,
});

// 2. Create tree
startTime = performance.now();
const treeEntries = blobIds.map((id, i) => ({
  mode: FileMode.REGULAR_FILE,
  name: `file-${i.toString().padStart(3, "0")}.ts`,
  id,
}));
const firstTreeId = await history.trees.store(treeEntries);
results.push({
  name: "Create tree",
  timeMs: performance.now() - startTime,
  details: `${FILE_COUNT} entries`,
});

// 3. Create initial commit
startTime = performance.now();
const firstCommitId = await createCommit(history, firstTreeId, [], "Initial commit");
await history.refs.set("refs/heads/main", firstCommitId);
results.push({
  name: "Create first commit",
  timeMs: performance.now() - startTime,
});

// 4. Create multiple commits
startTime = performance.now();
let previousCommitId = firstCommitId;
let previousTreeId = firstTreeId;

for (let i = 0; i < COMMIT_COUNT; i++) {
  // Modify a few blobs
  const modifiedEntries = [...treeEntries];
  for (let j = 0; j < 5; j++) {
    const idx = (i * 5 + j) % FILE_COUNT;
    const content = generateContent(SAMPLE_CODE, i * 1000 + j);
    const blobId = await history.blobs.store([encoder.encode(content)]);
    modifiedEntries[idx] = {
      mode: FileMode.REGULAR_FILE,
      name: modifiedEntries[idx].name,
      id: blobId,
    };
  }

  // Create new tree
  const newTreeId = await history.trees.store(modifiedEntries);

  // Create commit
  const commitId = await createCommit(
    history,
    newTreeId,
    [previousCommitId],
    `Commit ${i + 1}: Modified 5 files`,
  );

  previousCommitId = commitId;
  previousTreeId = newTreeId;
}

await history.refs.set("refs/heads/main", previousCommitId);
results.push({
  name: `Create ${COMMIT_COUNT} commits`,
  timeMs: performance.now() - startTime,
  details: "5 files modified each",
});

// 5. Read all commits (history traversal)
startTime = performance.now();
let commitCount = 0;
let currentId: string | undefined = previousCommitId;
while (currentId) {
  const commit = await history.commits.load(currentId);
  if (!commit) break;
  commitCount++;
  currentId = commit.parents[0];
}
results.push({
  name: "Traverse history",
  timeMs: performance.now() - startTime,
  details: `${commitCount} commits`,
});

// 6. Read trees
startTime = performance.now();
const treeEntriesLoaded: Array<{ name: string; id: string }> = [];
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
for await (const entry of (await history.trees.load(previousTreeId))!) {
  treeEntriesLoaded.push(entry);
}
results.push({
  name: "Load tree",
  timeMs: performance.now() - startTime,
  details: `${treeEntriesLoaded.length} entries`,
});

// 7. Read blobs
startTime = performance.now();
let blobsRead = 0;
for (const entry of treeEntriesLoaded) {
  // Load blob content
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  for await (const _chunk of (await history.blobs.load(entry.id))!) {
    // Just consume the content
  }
  blobsRead++;
}
results.push({
  name: "Load all blobs",
  timeMs: performance.now() - startTime,
  details: `${blobsRead} blobs`,
});

// 8. Reference operations
startTime = performance.now();
await history.refs.set("refs/heads/feature-1", previousCommitId);
await history.refs.set("refs/tags/v1.0", previousCommitId);
const _mainRef = await history.refs.resolve("refs/heads/main");
const _featureRef = await history.refs.resolve("refs/heads/feature-1");
const _tagRef = await history.refs.resolve("refs/tags/v1.0");
results.push({
  name: "Reference operations",
  timeMs: performance.now() - startTime,
  details: "2 writes, 3 reads",
});

// Print results table
console.log();
const header = ["Operation".padEnd(35), padLeft("Time", 12), "Details"].join(" | ");

console.log("-".repeat(80));
console.log(header);
console.log("-".repeat(80));

for (const result of results) {
  const row = [
    result.name.padEnd(35),
    padLeft(formatMs(result.timeMs), 12),
    result.details || "",
  ].join(" | ");
  console.log(row);
}

console.log("-".repeat(80));

// Summary
console.log();
console.log("=".repeat(80));
console.log("  Summary");
console.log("=".repeat(80));
console.log();

const totalTime = results.reduce((sum, r) => sum + r.timeMs, 0);
console.log(`Total benchmark time: ${formatMs(totalTime)}`);
console.log(`Total commits created: ${COMMIT_COUNT + 1}`);
console.log(`Total blobs stored: ${FILE_COUNT + COMMIT_COUNT * 5}`);
console.log(`Average commit time: ${formatMs(results[3].timeMs / COMMIT_COUNT)}`);
console.log(`History traversal: ${formatMs(results[4].timeMs)} for ${commitCount} commits`);

console.log();
console.log("=".repeat(80));
console.log("  Benchmark Complete");
console.log("=".repeat(80));
