# GCController: Generate Git-Compatible Pack Files

## Problem Statement

GCController creates invalid Git pack files that native git cannot read. When `pruneLoose: true` is set, the repository becomes corrupted.

## Root Cause

When `GCController.repack()` runs:

1. Calls `storage.deltify(targetId, candidateIds)` for loose objects
2. `deltify()` only stores the **DELTA relationship** via `storeDelta()`
3. **Base objects are NOT added to the pack**
4. `PendingPack.flush()` writes deltas as `REF_DELTA` (SHA-1 references to external bases)
5. With `pruneLoose: true`, loose objects (including bases) are deleted
6. Result: Pack has `REF_DELTA` references to non-existent objects

## Solution

Modify `GCController.repack()` to add ALL objects as full objects before deltification. This ensures:
- All base objects are in the pack
- Deltas use `OFS_DELTA` (offset-based, more efficient)
- Pack is self-contained and Git-compatible

## Files to Modify

### 1. `packages/core/src/delta/raw-store-with-delta.ts`

Add method to expose batch update handle:

```typescript
getBatchUpdate(): DeltaStoreUpdate | null {
  return this.batchUpdate;
}
```

### 2. `packages/core/src/pack/pending-pack.ts`

Modify `addDelta()` to replace existing entry for same ID:

```typescript
addDelta(id: ObjectId, baseId: ObjectId, delta: Uint8Array): void {
  // Remove existing entry if present (full object being replaced by delta)
  const existingIndex = this.entries.findIndex((e) => e.id === id);
  if (existingIndex >= 0) {
    const existing = this.entries[existingIndex];
    this.totalSize -= existing.type === "full" ? existing.content.length : existing.delta.length;
    this.entries.splice(existingIndex, 1);
  }

  this.entries.push({ type: "delta", id, baseId, delta });
  this.totalSize += delta.length;
}
```

### 3. `packages/core/src/delta/gc-controller.ts`

Modify `repack()` to add all objects as full objects first:

```typescript
private async repack(options?: RepackOptions): Promise<RepackResult> {
  // ... existing setup ...

  // Collect loose objects
  const looseIds: ObjectId[] = [];
  for await (const id of this.storage.keys()) {
    if (!(await this.storage.isDelta(id))) {
      looseIds.push(id);
    }
  }

  // Break deep chains (existing code)
  // ...

  this.storage.startBatch();

  try {
    // NEW: Get batch update handle
    const batchUpdate = this.storage.getBatchUpdate();
    if (!batchUpdate) throw new Error("Failed to get batch update");

    // NEW: Add ALL objects as full objects first
    for (const id of looseIds) {
      await batchUpdate.storeObject(id, this.storage.load(id));
    }

    // Deltify using sliding window (existing code)
    for (let i = 0; i < looseIds.length; i++) {
      const id = looseIds[i];
      const candidates = looseIds.slice(Math.max(0, i - windowSize), i);
      if (candidates.length > 0) {
        // This replaces the full object entry with a delta entry
        await this.storage.deltify(id, candidates);
      }
    }

    await this.storage.endBatch();
  } catch (e) {
    this.storage.cancelBatch();
    throw e;
  }

  // ... rest of existing code ...
}
```

### 4. `packages/core/tests/delta/gc-test-utils.ts`

Replace MockDeltaStore with PackDeltaStore using in-memory FilesApi:

```typescript
import { MemFilesApi, FilesApi } from "@statewalker/webrun-files";
import { PackDeltaStore } from "../../src/pack/pack-delta-store.js";

export async function createTestRepository(gcOptions?: GCScheduleOptions): Promise<GCTestContext> {
  const memFiles = new FilesApi(new MemFilesApi());

  // Create pack directory structure
  await memFiles.mkdir(".git/objects/pack");

  // Use real PackDeltaStore instead of MockDeltaStore
  const packDeltaStore = new PackDeltaStore({
    files: memFiles,
    basePath: ".git/objects/pack",
  });

  const deltaStorage = new RawStoreWithDelta({
    objects: rawStore,
    deltas: packDeltaStore,
  });

  // ... rest of setup ...
}
```

### 5. Delete `packages/core/tests/mocks/mock-delta-store.ts`

Remove the mock implementation. Update any remaining imports to use PackDeltaStore.

## Testing Strategy

1. **Unit Tests**: Verify `PendingPack.addDelta()` replaces existing entries
2. **Integration Tests**: Run `GCController.repack()` with real PackDeltaStore
3. **Native Git Verification**: Run `git fsck` after GC to validate pack files
4. **Example App**: Verify `apps/example-git-lifecycle` passes with GCController-based GC

## Verification

```bash
# Run tests
pnpm --filter @statewalker/vcs-core test

# Run example app (uses native git verification)
cd apps/example-git-lifecycle && pnpm start

# Manual verification
git fsck --full
git log --oneline
```

## Implementation Order

1. Add `getBatchUpdate()` to RawStoreWithDelta
2. Modify `PendingPack.addDelta()` to handle replacement
3. Update `GCController.repack()` to add all objects first
4. Replace MockDeltaStore with PackDeltaStore in tests
5. Delete MockDeltaStore
6. Run tests and verify with native git
