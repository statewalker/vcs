/**
 * Example 11: Delta Strategies
 *
 * Demonstrates storage optimization using the DeltaApi and
 * low-level delta compression utilities.
 *
 * Topics covered:
 * - Understanding blob delta compression
 * - Using DeltaApi for storage optimization
 * - Batch operations for atomic repacking
 * - Delta chain inspection and management
 * - Low-level delta computation with createDeltaRanges/applyDelta
 *
 * Run with: pnpm start
 */

import {
  createMemoryHistoryWithOperations,
  FileMode,
  type HistoryWithOperations,
} from "@statewalker/vcs-core";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ============================================================
//  Setup: Create repository with similar content
// ============================================================

console.log("=== Setup: Create Repository with Similar Content ===\n");

const history: HistoryWithOperations = createMemoryHistoryWithOperations();
await history.initialize();
await history.refs.setSymbolic("HEAD", "refs/heads/main");

const now = Date.now() / 1000;

// Create multiple versions of the same file (ideal for delta compression)
const versions = [
  "# Project Documentation\n\nThis is version 1 of the documentation.\nIt contains basic project information.\n\n## Getting Started\n\nInstall dependencies and run the project.\n",
  "# Project Documentation\n\nThis is version 2 of the documentation.\nIt contains updated project information.\n\n## Getting Started\n\nInstall dependencies and run the project.\n\n## Configuration\n\nSet up your config.json with the required fields.\n",
  "# Project Documentation\n\nThis is version 3 of the documentation.\nIt contains comprehensive project information.\n\n## Getting Started\n\nInstall dependencies and run the project.\n\n## Configuration\n\nSet up your config.json with the required fields.\n\n## API Reference\n\nSee the API docs for endpoint details.\n",
];

const blobIds: string[] = [];
let parentCommitId = "";

for (let i = 0; i < versions.length; i++) {
  const blobId = await history.blobs.store([encoder.encode(versions[i])]);
  blobIds.push(blobId);

  const treeId = await history.trees.store([
    { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId },
  ]);

  const commitId = await history.commits.store({
    tree: treeId,
    parents: parentCommitId !== "" ? [parentCommitId] : [],
    author: {
      name: "Dev",
      email: "dev@example.com",
      timestamp: now + i * 3600,
      tzOffset: "+0000",
    },
    committer: {
      name: "Dev",
      email: "dev@example.com",
      timestamp: now + i * 3600,
      tzOffset: "+0000",
    },
    message: `Version ${i + 1}`,
  });
  parentCommitId = commitId;
}
await history.refs.set("refs/heads/main", parentCommitId);

console.log("  Created 3 commits with incrementally evolving README.md");
for (let i = 0; i < blobIds.length; i++) {
  const size = await history.blobs.size(blobIds[i]);
  console.log(`  Version ${i + 1}: blob ${blobIds[i].slice(0, 7)} (${size} bytes)`);
}

// ============================================================
//  Step 1: Understanding DeltaApi
// ============================================================

console.log("\n=== Step 1: Understanding DeltaApi ===\n");

console.log("  The DeltaApi provides blob delta operations for storage optimization.");
console.log("  Only blobs support delta compression in internal storage.");
console.log("  Trees and commits are always stored as-is for fast access.\n");

// Check backend capabilities
console.log(`  Backend capabilities:`);
console.log(`    nativeBlobDeltas: ${history.capabilities.nativeBlobDeltas}`);
console.log(`    randomAccess:     ${history.capabilities.randomAccess}`);
console.log(`    atomicBatch:      ${history.capabilities.atomicBatch}`);
console.log(`    nativeGitFormat:  ${history.capabilities.nativeGitFormat}`);

// ============================================================
//  Step 2: Check Delta State
// ============================================================

console.log("\n=== Step 2: Check Delta State ===\n");

// Check if any blobs are currently stored as deltas
for (const blobId of blobIds) {
  const isDelta = await history.delta.isDelta(blobId);
  console.log(`  ${blobId.slice(0, 7)} isDelta: ${isDelta}`);
}

// Enumerate all delta relationships
let deltaCount = 0;
for await (const rel of history.delta.listDeltas()) {
  console.log(
    `  Delta: ${rel.targetId.slice(0, 7)} -> ${rel.baseId.slice(0, 7)} ` +
      `(depth=${rel.depth}, ratio=${rel.ratio.toFixed(2)})`,
  );
  deltaCount++;
}
console.log(`  Total delta relationships: ${deltaCount}`);

// ============================================================
//  Step 3: Batch Operations
// ============================================================

console.log("\n=== Step 3: Batch Operations ===\n");

console.log("  Batch operations allow atomic delta changes.");
console.log("  All changes are applied together when endBatch() is called.");
console.log("  If cancelBatch() is called, all changes are discarded.\n");

// Start a batch
history.delta.startBatch();
console.log("  Batch started.");

// In a real scenario, you would use findBlobDelta and deltifyBlob:
//
//   const candidates = async function*() {
//     yield blobIds[0]; // try v1 as base
//   };
//   const result = await history.delta.blobs.findBlobDelta(blobIds[1], candidates());
//   if (result) {
//     await history.delta.blobs.deltifyBlob(blobIds[1], result.baseId, result.delta);
//   }
//
// For this example, we'll just demonstrate the batch pattern:
console.log("  (In production, deltify blobs here using findBlobDelta + deltifyBlob)");

// Cancel the batch since this is a demo
history.delta.cancelBatch();
console.log("  Batch cancelled (demo - no actual deltas applied).\n");

console.log("  Batch pattern for GC/repacking:");
console.log("    delta.startBatch()");
console.log("    for each blob: findBlobDelta + deltifyBlob");
console.log("    delta.endBatch()  // atomic commit");
console.log("    (or delta.cancelBatch() on error)");

// ============================================================
//  Step 4: Delta Chain Inspection
// ============================================================

console.log("\n=== Step 4: Delta Chain Inspection ===\n");

console.log("  getDeltaChain() reveals the chain of base objects needed");
console.log("  to reconstruct a blob. Deeper chains trade space for read latency.\n");

for (const blobId of blobIds) {
  const chain = await history.delta.getDeltaChain(blobId);
  if (chain) {
    console.log(`  ${blobId.slice(0, 7)}: depth=${chain.depth}, totalSize=${chain.totalSize}`);
    console.log(`    baseIds: ${chain.baseIds.map((id) => id.slice(0, 7)).join(" -> ")}`);
  } else {
    console.log(`  ${blobId.slice(0, 7)}: stored as full object (no delta chain)`);
  }
}

console.log("\n  getDependents() shows which blobs depend on a given base.");
console.log("  Important for safe deletion: a base cannot be deleted while");
console.log("  dependents exist.\n");

for (const blobId of blobIds) {
  const dependents: string[] = [];
  for await (const depId of history.delta.getDependents(blobId)) {
    dependents.push(depId.slice(0, 7));
  }
  console.log(
    `  ${blobId.slice(0, 7)} dependents: ${dependents.length > 0 ? dependents.join(", ") : "none"}`,
  );
}

// ============================================================
//  Step 5: Low-Level Delta Utilities
// ============================================================

console.log("\n=== Step 5: Low-Level Delta Utilities ===\n");

console.log("  The vcs-utils package provides raw delta computation.");
console.log("  These operate on byte arrays, independent of storage.\n");

const { createDeltaRanges, createDelta, applyDelta } = await import("@statewalker/vcs-utils/diff");

const baseContent = encoder.encode(versions[0]);
const targetContent = encoder.encode(versions[1]);

// Compute delta ranges (what to copy from source, what to insert from target)
// DeltaRange uses .from ("source" = copy, "target" = insert) and .len
const ranges = [...createDeltaRanges(baseContent, targetContent)];

let copyCount = 0;
let insertCount = 0;
let copyBytes = 0;
let insertBytes = 0;
for (const range of ranges) {
  if (range.from === "source") {
    copyCount++;
    copyBytes += range.len;
  } else {
    insertCount++;
    insertBytes += range.len;
  }
}

console.log(`  Base size:     ${baseContent.length} bytes`);
console.log(`  Target size:   ${targetContent.length} bytes`);
console.log(`  Delta ranges:  ${ranges.length} total`);
console.log(`    Copy:   ${copyCount} ranges (${copyBytes} bytes from base)`);
console.log(`    Insert: ${insertCount} ranges (${insertBytes} bytes literal)\n`);

// Create delta instructions (Delta objects: start, copy, insert, finish)
const deltaInstructions = [...createDelta(baseContent, targetContent, ranges)];

// Count instruction types for display
let deltaDataSize = 0;
for (const instr of deltaInstructions) {
  if (instr.type === "copy") deltaDataSize += instr.len;
  if (instr.type === "insert") deltaDataSize += instr.data.length;
}

console.log(`  Delta instructions: ${deltaInstructions.length}`);
console.log(`  Delta data size:   ${deltaDataSize} bytes`);
const savings = targetContent.length - deltaDataSize;
console.log(`  Savings:           ${savings} bytes`);

// Apply delta instructions to reconstruct the target
const reconstructed = [...applyDelta(baseContent, deltaInstructions)];
const reconstructedContent = new Uint8Array(
  reconstructed.reduce((sum, chunk) => sum + chunk.length, 0),
);
let offset = 0;
for (const chunk of reconstructed) {
  reconstructedContent.set(chunk, offset);
  offset += chunk.length;
}

const matches = decoder.decode(reconstructedContent) === decoder.decode(targetContent);
console.log(`  Reconstruction: ${matches ? "matches original" : "MISMATCH!"}`);

// ============================================================
//  Summary
// ============================================================

console.log("\n=== Summary: When to Use Delta Compression ===\n");
console.log("  Use DeltaApi when:");
console.log("    - Running garbage collection (GC)");
console.log("    - Optimizing storage after many commits");
console.log("    - Repacking objects for better compression");
console.log("    - Analyzing storage efficiency\n");
console.log("  Use low-level delta utils when:");
console.log("    - Building custom pack file writers");
console.log("    - Implementing wire-level transport");
console.log("    - Computing diffs between arbitrary byte buffers\n");
console.log("  Key insight: Only blobs have delta support in internal storage.");
console.log("  Pack serialization (wire format) can still use deltas for all types.");

await history.close();

console.log("\nExample completed successfully!");
