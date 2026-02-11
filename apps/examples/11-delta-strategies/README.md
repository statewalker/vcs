# 11-delta-strategies

The DeltaApi provides storage optimization through blob delta compression. This example walks through checking delta state, batch operations for atomic repacking, delta chain inspection, and low-level delta computation using `createDeltaRanges` and `applyDelta`.

## Quick Start

```bash
pnpm --filter @statewalker/vcs-example-11-delta-strategies start
```

## What You'll Learn

- How the DeltaApi exposes blob delta operations for storage optimization
- Checking delta state and enumerating delta relationships
- Batch operations for atomic, all-or-nothing delta changes
- Delta chain inspection and dependent tracking for safe deletion
- Low-level delta computation with `createDeltaRanges`, `createDelta`, and `applyDelta`
- Analyzing compression ratios and storage savings

## Prerequisites

- Node.js 18+
- pnpm
- Completed [06-internal-storage](../06-internal-storage/)

---

## Step-by-Step Guide

### Setup: Create Repository with Similar Content

**File:** [src/main.ts](src/main.ts)

The example begins by creating a repository with three commits, each containing an incrementally evolving `README.md` file. These near-identical blobs are ideal candidates for delta compression.

```typescript
const history: HistoryWithOperations = createMemoryHistoryWithOperations();
await history.initialize();
await history.refs.setSymbolic("HEAD", "refs/heads/main");

const versions = [
  "# Project Documentation\n\nThis is version 1...",
  "# Project Documentation\n\nThis is version 2...",
  "# Project Documentation\n\nThis is version 3...",
];

const blobIds: string[] = [];
for (let i = 0; i < versions.length; i++) {
  const blobId = await history.blobs.store([encoder.encode(versions[i])]);
  blobIds.push(blobId);
  // ... create tree and commit for each version
}
```

**Key APIs:**
- `createMemoryHistoryWithOperations()` - Create in-memory history with delta and serialization support
- `BlobStore.store()` - Store blob content, returns content-addressed ID
- `CommitStore.store()` - Create commit object linking tree to history

---

### Understanding DeltaApi

**File:** [src/main.ts](src/main.ts)

The DeltaApi is available on `HistoryWithOperations` instances. Only blobs support delta compression in internal storage because they represent 90%+ of repository data, while trees and commits are small and need fast access.

```typescript
console.log(`  Backend capabilities:`);
console.log(`    nativeBlobDeltas: ${history.capabilities.nativeBlobDeltas}`);
console.log(`    randomAccess:     ${history.capabilities.randomAccess}`);
console.log(`    atomicBatch:      ${history.capabilities.atomicBatch}`);
console.log(`    nativeGitFormat:  ${history.capabilities.nativeGitFormat}`);
```

**Key APIs:**
- `history.capabilities` - Inspect backend feature support
- `history.delta` - Access the DeltaApi interface

---

### Checking Delta State

**File:** [src/main.ts](src/main.ts)

Before optimizing, you can inspect which blobs are currently stored as deltas and enumerate all existing delta relationships. The `isDelta` check returns whether a blob is stored as a delta, and `listDeltas` streams all delta relationships with depth and compression ratio.

```typescript
for (const blobId of blobIds) {
  const isDelta = await history.delta.isDelta(blobId);
  console.log(`  ${blobId.slice(0, 7)} isDelta: ${isDelta}`);
}

for await (const rel of history.delta.listDeltas()) {
  console.log(
    `  Delta: ${rel.targetId.slice(0, 7)} -> ${rel.baseId.slice(0, 7)} ` +
      `(depth=${rel.depth}, ratio=${rel.ratio.toFixed(2)})`,
  );
}
```

**Key APIs:**
- `DeltaApi.isDelta(id)` - Check if a blob is stored as a delta
- `DeltaApi.listDeltas()` - Async iterable of all delta relationships (targetId, baseId, depth, ratio)

---

### Batch Operations

**File:** [src/main.ts](src/main.ts)

Batch operations wrap multiple delta changes in an atomic transaction. All changes are applied together when `endBatch()` is called, or discarded entirely with `cancelBatch()`. This is essential for garbage collection and repacking workflows where partial application could corrupt state.

```typescript
history.delta.startBatch();
try {
  // In production: findBlobDelta + deltifyBlob for each candidate
  const candidates = async function* () {
    yield blobIds[0];
  };
  const result = await history.delta.blobs.findBlobDelta(blobIds[1], candidates());
  if (result) {
    await history.delta.blobs.deltifyBlob(blobIds[1], result.baseId, result.delta);
  }
  await history.delta.endBatch(); // Atomic commit
} catch (error) {
  history.delta.cancelBatch(); // Discard all changes
  throw error;
}
```

**Key APIs:**
- `DeltaApi.startBatch()` - Begin atomic delta transaction
- `DeltaApi.endBatch()` - Commit all pending delta changes atomically
- `DeltaApi.cancelBatch()` - Discard all pending changes
- `BlobDeltaApi.findBlobDelta(targetId, candidates)` - Find best delta from candidate bases
- `BlobDeltaApi.deltifyBlob(targetId, baseId, delta)` - Store blob as delta against base

---

### Delta Chain Inspection

**File:** [src/main.ts](src/main.ts)

`getDeltaChain()` reveals the chain of base objects needed to reconstruct a blob. Deeper chains trade storage space for read latency. `getDependents()` shows which blobs depend on a given base, which is important for safe deletion -- a base cannot be removed while dependents exist.

```typescript
for (const blobId of blobIds) {
  const chain = await history.delta.getDeltaChain(blobId);
  if (chain) {
    console.log(`  ${blobId.slice(0, 7)}: depth=${chain.depth}, totalSize=${chain.totalSize}`);
    console.log(`    baseIds: ${chain.baseIds.map((id) => id.slice(0, 7)).join(" -> ")}`);
  } else {
    console.log(`  ${blobId.slice(0, 7)}: stored as full object (no delta chain)`);
  }
}

for (const blobId of blobIds) {
  const dependents: string[] = [];
  for await (const depId of history.delta.getDependents(blobId)) {
    dependents.push(depId.slice(0, 7));
  }
  console.log(`  ${blobId.slice(0, 7)} dependents: ${dependents.length > 0 ? dependents.join(", ") : "none"}`);
}
```

**Key APIs:**
- `DeltaApi.getDeltaChain(id)` - Get chain info (depth, totalSize, baseIds)
- `DeltaApi.getDependents(baseId)` - Async iterable of blob IDs depending on this base

---

### Low-Level Delta Utilities

**File:** [src/main.ts](src/main.ts)

The `@statewalker/vcs-utils/diff` package provides raw delta computation on byte arrays, independent of any storage backend. This is useful for building custom pack file writers or transport implementations.

```typescript
const { createDeltaRanges, createDelta, applyDelta } = await import("@statewalker/vcs-utils/diff");

const baseContent = encoder.encode(versions[0]);
const targetContent = encoder.encode(versions[1]);

// Compute delta ranges (copy from source vs insert from target)
const ranges = [...createDeltaRanges(baseContent, targetContent)];

// Create delta instructions (start, copy, insert, finish)
const deltaInstructions = [...createDelta(baseContent, targetContent, ranges)];

// Reconstruct target from base + delta
const reconstructed = [...applyDelta(baseContent, deltaInstructions)];
```

**Key APIs:**
- `createDeltaRanges(base, target)` - Compute DeltaRange array (from="source" for copy, "target" for insert)
- `createDelta(base, target, ranges)` - Create Delta instructions from ranges
- `applyDelta(base, delta)` - Reconstruct target from base and delta instructions

---

## Key Concepts

### Why Only Blobs?

Internal storage only tracks blob deltas because blobs account for 90%+ of repository storage, and similar files across commits delta very well. Trees and commits are small (100B--10KB) and need fast access without the latency of resolving delta chains. Pack files used for wire format can still use deltas for all object types.

### DeltaApi Overview

The DeltaApi is the high-level interface for blob delta operations. It provides inspection methods (`isDelta`, `listDeltas`, `getDeltaChain`, `getDependents`) and mutation methods via its `blobs` sub-API (`findBlobDelta`, `deltifyBlob`, `undeltifyBlob`). The API sits on top of the storage layer and respects backend capabilities -- not all backends support native blob deltas.

### Batch Operations

Batch operations provide atomic, all-or-nothing semantics for delta changes. This is critical during garbage collection and repacking, where a failure partway through could leave storage in an inconsistent state. Call `startBatch()` before making changes, `endBatch()` to commit them atomically, or `cancelBatch()` to roll everything back.

### Low-Level Deltas

The low-level utilities in `@statewalker/vcs-utils/diff` work directly on `Uint8Array` buffers. `createDeltaRanges` determines which byte ranges to copy from the base and which to insert as new data. `createDelta` converts those ranges into compact delta instructions, and `applyDelta` reconstructs the target by replaying those instructions against the base. These functions power both internal delta compression and pack-file serialization.

---

## Project Structure

```
apps/examples/11-delta-strategies/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    └── main.ts          # Complete example: setup, DeltaApi, batches, chains, low-level deltas
```

---

## Output Example

```
=== Setup: Create Repository with Similar Content ===

  Created 3 commits with incrementally evolving README.md
  Version 1: blob 8a3f2c1 (142 bytes)
  Version 2: blob b7e4d09 (218 bytes)
  Version 3: blob c1a5f38 (289 bytes)

=== Step 1: Understanding DeltaApi ===

  The DeltaApi provides blob delta operations for storage optimization.
  Only blobs support delta compression in internal storage.
  Trees and commits are always stored as-is for fast access.

  Backend capabilities:
    nativeBlobDeltas: true
    randomAccess:     true
    atomicBatch:      true
    nativeGitFormat:  false

=== Step 2: Check Delta State ===

  8a3f2c1 isDelta: false
  b7e4d09 isDelta: false
  c1a5f38 isDelta: false
  Total delta relationships: 0

=== Step 3: Batch Operations ===

  Batch started.
  (In production, deltify blobs here using findBlobDelta + deltifyBlob)
  Batch cancelled (demo - no actual deltas applied).

  Batch pattern for GC/repacking:
    delta.startBatch()
    for each blob: findBlobDelta + deltifyBlob
    delta.endBatch()  // atomic commit
    (or delta.cancelBatch() on error)

=== Step 4: Delta Chain Inspection ===

  getDeltaChain() reveals the chain of base objects needed
  to reconstruct a blob. Deeper chains trade space for read latency.

  8a3f2c1: stored as full object (no delta chain)
  b7e4d09: stored as full object (no delta chain)
  c1a5f38: stored as full object (no delta chain)

  getDependents() shows which blobs depend on a given base.

  8a3f2c1 dependents: none
  b7e4d09 dependents: none
  c1a5f38 dependents: none

=== Step 5: Low-Level Delta Utilities ===

  Base size:     142 bytes
  Target size:   218 bytes
  Delta ranges:  5 total
    Copy:   3 ranges (138 bytes from base)
    Insert: 2 ranges (80 bytes literal)

  Delta instructions: 8
  Delta data size:   164 bytes
  Savings:           54 bytes
  Reconstruction: matches original

=== Summary: When to Use Delta Compression ===

  Use DeltaApi when:
    - Running garbage collection (GC)
    - Optimizing storage after many commits
    - Repacking objects for better compression
    - Analyzing storage efficiency

  Use low-level delta utils when:
    - Building custom pack file writers
    - Implementing wire-level transport
    - Computing diffs between arbitrary byte buffers

  Key insight: Only blobs have delta support in internal storage.
  Pack serialization (wire format) can still use deltas for all types.

Example completed successfully!
```

---

## API Reference Links

### Core Package (packages/core)

| Interface/Class | Location | Purpose |
|-----------------|----------|---------|
| `DeltaApi` | [storage/delta/delta-api.ts](../../../packages/core/src/storage/delta/delta-api.ts) | High-level delta operations interface |
| `BlobDeltaApi` | [storage/delta/blob-delta-api.ts](../../../packages/core/src/storage/delta/blob-delta-api.ts) | Blob-specific delta operations |
| `DeltaEngine` | [storage/delta/delta-engine.ts](../../../packages/core/src/storage/delta/delta-engine.ts) | Delta computation engine |
| `DeltaStore` | [storage/delta/delta-store.ts](../../../packages/core/src/storage/delta/delta-store.ts) | Delta relationship storage |
| `DeltaIndex` | [storage/delta/delta-index.ts](../../../packages/core/src/storage/delta/delta-index.ts) | Delta lookup index |
| `BlobStore` | [history/blobs/](../../../packages/core/src/history/blobs/) | Blob storage |
| `CommitStore` | [history/commits/](../../../packages/core/src/history/commits/) | Commit storage |

### Utils Package (packages/utils)

| Function | Location | Purpose |
|----------|----------|---------|
| `createDeltaRanges` | [diff/delta/create-delta-ranges.ts](../../../packages/utils/src/diff/delta/create-delta-ranges.ts) | Compute copy/insert ranges between buffers |
| `createDelta` | [diff/delta/create-delta.ts](../../../packages/utils/src/diff/delta/create-delta.ts) | Create delta instructions from ranges |
| `applyDelta` | [diff/delta/apply-delta.ts](../../../packages/utils/src/diff/delta/apply-delta.ts) | Reconstruct target from base + delta |

---

## Next Steps

- [06-internal-storage](../06-internal-storage/) -- Loose objects and pack files
- [10-custom-storage](../10-custom-storage/) -- Building storage backends
- [09-repository-access](../09-repository-access/) -- Transport layer integration
