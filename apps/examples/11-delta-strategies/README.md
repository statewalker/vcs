# Example 11: Delta Strategies

Storage optimization using DeltaApi and low-level delta compression.

## What You'll Learn

- **DeltaApi**: High-level interface for blob delta operations
- **Batch operations**: Atomic repacking with startBatch/endBatch
- **Delta chains**: Understanding depth, dependents, and chain info
- **Low-level deltas**: Computing deltas with createDeltaRanges and applyDelta
- **Storage analysis**: Inspecting delta relationships and compression ratios

## Running the Example

```bash
pnpm start
```

## Key Concepts

### Why Only Blobs?

Internal storage only tracks blob deltas because:
- Blobs are 90%+ of repository storage
- Same files across commits delta very well
- Trees and commits are small (100B-10KB) and need fast access
- Delta chain resolution adds latency for every read

Pack files (wire format) can still use deltas for all object types.

### DeltaApi Overview

```typescript
const history = createMemoryHistoryWithOperations();

// Check if a blob is stored as a delta
const isDelta = await history.delta.isDelta(blobId);

// Get delta chain information
const chain = await history.delta.getDeltaChain(blobId);
// chain.depth, chain.totalSize, chain.baseIds

// List all delta relationships
for await (const rel of history.delta.listDeltas()) {
  // rel.targetId, rel.baseId, rel.depth, rel.ratio
}

// Check what depends on a base
for await (const depId of history.delta.getDependents(baseId)) {
  // Cannot delete base while dependents exist
}
```

### BlobDeltaApi Operations

```typescript
const blobDelta = history.delta.blobs;

// Find best delta for a blob
const candidates = async function*() {
  yield previousVersionBlobId;
};
const result = await blobDelta.findBlobDelta(targetId, candidates());
if (result) {
  console.log(`Ratio: ${result.ratio}, savings: ${result.savings} bytes`);
  await blobDelta.deltifyBlob(targetId, result.baseId, result.delta);
}

// Expand a delta back to full content
await blobDelta.undeltifyBlob(blobId);

// Check delta status
const isDelta = await blobDelta.isBlobDelta(blobId);
const chainInfo = await blobDelta.getBlobDeltaChain(blobId);
```

### Batch Operations for GC

```typescript
// All-or-nothing delta changes
history.delta.startBatch();
try {
  for (const blobId of blobsToOptimize) {
    const result = await history.delta.blobs.findBlobDelta(blobId, candidates);
    if (result) {
      await history.delta.blobs.deltifyBlob(blobId, result.baseId, result.delta);
    }
  }
  await history.delta.endBatch(); // Atomic commit
} catch (error) {
  history.delta.cancelBatch();    // Discard all changes
  throw error;
}
```

### Low-Level Delta Utilities

For custom pack writers or transport implementations:

```typescript
import { createDeltaRanges, createDelta, applyDelta } from "@statewalker/vcs-utils/diff";

const base = encoder.encode("Original content...");
const target = encoder.encode("Modified content...");

// Compute what to copy/insert (DeltaRange: from="source"|"target", start, len)
const ranges = [...createDeltaRanges(base, target)];

// Create delta instructions (Delta: start, copy, insert, finish)
const delta = [...createDelta(base, target, ranges)];

// Reconstruct target from base + delta instructions
const reconstructed = [...applyDelta(base, delta)];
```

## See Also

- [Example 06: Internal Storage](../06-internal-storage/) - Loose objects and pack files
- [Example 10: Custom Storage](../10-custom-storage/) - Building storage backends
- [Example 09: Repository Access](../09-repository-access/) - Transport layer integration
