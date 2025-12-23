# Implementation Plan: Remove ObjectStore Interface

**Date:** 2025-12-23
**Status:** Proposed
**Related Analysis:** [notes/src/2025-12-23/01-[vcs]-objectstore-vs-rawstore-analysis.md](../../notes/src/2025-12-23/01-[vcs]-objectstore-vs-rawstore-analysis.md)

## Overview

Remove the `ObjectStore` interface and replace all usages with `RawStore` + `GitObjectStore`. This simplifies the storage architecture from 3 layers to 2 layers.

## Current State

```
packages/vcs/src/interfaces/object-store.ts     ← ObjectStore interface (TO REMOVE)
packages/vcs/src/binary-storage/interfaces/raw-store.ts  ← RawStore interface (KEEP)
packages/vcs/src/interfaces/volatile-store.ts   ← VolatileStore interface (KEEP)
packages/core/src/stores/git-object-store.ts    ← GitObjectStore interface (KEEP)
```

### Files Implementing ObjectStore (6 implementations)

| File | Class | Action |
|------|-------|--------|
| `storage-git/src/git-raw-objects-storage.ts` | GitRawObjectStorage | DELETE (already @deprecated) |
| `storage-git/src/git-object-storage.ts` | GitObjectStorage | DELETE |
| `storage-git/src/git-pack-storage.ts` | GitPackStorage | CONVERT to PackReader |
| `storage-git/src/git-delta-object-storage.ts` | GitDeltaObjectStorage | REFACTOR |
| `storage-git/src/composite-object-storage.ts` | CompositeObjectStorage | DELETE or convert to CompositeRawStore |
| `sandbox/src/base/default-object-store.ts` | DefaultObjectStore | REFACTOR to use RawStore |

### Files Using ObjectStore (imports)

| File | Usage |
|------|-------|
| `storage-git/src/git-repository.ts` | Constructor parameter |
| `storage-git/src/git-storage.ts` | Internal field |
| `storage-git/src/git-commit-storage.ts` | Constructor parameter |
| `storage-git/src/git-file-tree-storage.ts` | Constructor parameter |
| `storage-git/src/git-tag-storage.ts` | Constructor parameter |
| `storage-git/src/typed-object-utils.ts` | Function parameters |

---

## Phase 1: Prepare Core Interfaces

### Task 1.1: Verify RawStore and VolatileStore Location

Current locations:
- `RawStore`: `@webrun-vcs/vcs/binary-storage`
- `VolatileStore`: `@webrun-vcs/vcs/interfaces`

**Decision needed:** Keep in `vcs` package or move to `core`?

**Recommendation:** Keep in `vcs` package. These are low-level storage interfaces that don't need to be in core. The `core` package contains typed Git stores that build on top of these.

### Task 1.2: Ensure GitObjectStore Uses RawStore

The new `GitObjectStoreImpl` in `packages/vcs/src/object-storage/git-codec/git-object-store.ts` already uses:
- `RawStore` for persistence
- `VolatileStore` for buffering

This is the correct pattern. No changes needed here.

---

## Phase 2: Remove Deprecated ObjectStore Implementations

### Task 2.1: Delete GitRawObjectStorage

**File:** `packages/storage-git/src/git-raw-objects-storage.ts`

Already marked `@deprecated`. Delete the entire file.

**Update exports:**
- Remove from `packages/storage-git/src/index.ts`

### Task 2.2: Delete GitObjectStorage

**File:** `packages/storage-git/src/git-object-storage.ts`

This class wraps ObjectStore to add Git blob semantics. With the new architecture, use typed stores directly.

**Actions:**
1. Delete `packages/storage-git/src/git-object-storage.ts`
2. Remove from `packages/storage-git/src/index.ts`

### Task 2.3: Convert GitPackStorage to PackReader

**File:** `packages/storage-git/src/git-pack-storage.ts`

This is read-only pack file storage. Convert to a simpler interface:

```typescript
export interface PackReader {
  load(id: ObjectId): AsyncIterable<Uint8Array>;
  has(id: ObjectId): Promise<boolean>;
  getSize(id: ObjectId): Promise<number>;
  list(): AsyncIterable<ObjectId>;
  refresh(): Promise<void>;
}
```

**Actions:**
1. Rename class to `PackReader`
2. Remove `implements ObjectStore`
3. Remove `store()` and `delete()` methods (throw errors anyway)
4. Update exports

### Task 2.4: Refactor GitDeltaObjectStorage

**File:** `packages/storage-git/src/git-delta-object-storage.ts`

This combines loose and pack storage with delta compression. Refactor to use:
- `RawStore` for loose objects
- `PackReader` for pack files

```typescript
export class DeltaStorage {
  constructor(
    private readonly looseStore: RawStore,
    private readonly packReader: PackReader,
    private readonly volatileStore: VolatileStore,
  ) {}

  // Delegate to appropriate storage
  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<number> {
    return this.looseStore.store(key, content);
  }

  async *load(key: string): AsyncIterable<Uint8Array> {
    if (await this.looseStore.has(key)) {
      yield* this.looseStore.load(key);
    } else {
      yield* this.packReader.load(key);
    }
  }
}
```

### Task 2.5: Delete or Convert CompositeObjectStorage

**File:** `packages/storage-git/src/composite-object-storage.ts`

**Option A:** Delete entirely - the delta storage handles composition
**Option B:** Convert to `CompositeRawStore` implementing `RawStore`

**Recommendation:** Option A - delete. The composition logic belongs in higher-level code (DeltaStorage).

---

## Phase 3: Update Dependent Code

### Task 3.1: Update typed-object-utils.ts

**File:** `packages/storage-git/src/typed-object-utils.ts`

These utility functions take `ObjectStore`. Change to use `GitObjectStore`:

```typescript
// Before
export async function storeCommit(storage: ObjectStore, content: Uint8Array): Promise<ObjectId>

// After
export async function storeCommit(storage: GitObjectStore, content: Uint8Array): Promise<ObjectId> {
  return storage.store("commit", [content]);
}
```

**Or:** Mark as deprecated and encourage using typed stores directly.

### Task 3.2: Update git-repository.ts

**File:** `packages/storage-git/src/git-repository.ts`

Currently wraps `ObjectStore`. Update to use `RawStore` + create `GitObjectStoreImpl`:

```typescript
// Before
constructor(rawStorage: ObjectStore) {
  this.objects = rawStorage;
}

// After
constructor(rawStore: RawStore, volatileStore: VolatileStore) {
  this.objects = new GitObjectStoreImpl(volatileStore, rawStore);
}
```

### Task 3.3: Update git-storage.ts

**File:** `packages/storage-git/src/git-storage.ts`

Similar pattern - update constructor to take `RawStore` + `VolatileStore`.

### Task 3.4: Delete git-commit-storage.ts, git-file-tree-storage.ts, git-tag-storage.ts

These wrap `ObjectStore` with typed APIs. They're redundant with the new typed stores from `@webrun-vcs/vcs/object-storage`.

**Files to delete:**
- `packages/storage-git/src/git-commit-storage.ts`
- `packages/storage-git/src/git-file-tree-storage.ts`
- `packages/storage-git/src/git-tag-storage.ts`

---

## Phase 4: Update Factory Functions

### Task 4.1: Update createFileObjectStores

**File:** `packages/storage-git/src/object-storage/index.ts`

Already uses the new pattern. Verify it works without ObjectStore.

### Task 4.2: Update createStreamingStores (deprecated)

**File:** `packages/storage-git/src/create-streaming-stores.ts`

Already marked `@deprecated`. Can delete after migration.

### Task 4.3: Update store-mem, store-sql, store-kv factories

These packages use the new pattern (`MemRawStore`, `SqlRawStore`, `KvRawStore`). Verify no ObjectStore dependencies.

---

## Phase 5: Remove ObjectStore Interface

### Task 5.1: Delete ObjectStore Interface

**File:** `packages/vcs/src/interfaces/object-store.ts`

Delete the file.

### Task 5.2: Update vcs package exports

**File:** `packages/vcs/src/interfaces/index.ts`

Remove:
```typescript
export * from "./object-store.js";
```

---

## Phase 6: Update Tests

### Task 6.1: Update storage-git tests

Tests using ObjectStore need updating:
- `tests/gc/*.test.ts` - Update mock implementations
- `tests/delta/*.test.ts` - Update mock implementations

### Task 6.2: Update testing package

**File:** `packages/testing/src/suites/object-storage.suite.ts`

Rename to `raw-storage.suite.ts` and test `RawStore` interface.

### Task 6.3: Run full test suite

```bash
pnpm test
```

---

## Phase 7: Update sandbox package

### Task 7.1: Refactor DefaultObjectStore

**File:** `packages/sandbox/src/base/default-object-store.ts`

This is an experimental implementation. Either:
- Delete (if unused)
- Refactor to use `RawStore` pattern

---

## Migration Checklist

### Files to DELETE
- [ ] `packages/storage-git/src/git-raw-objects-storage.ts`
- [ ] `packages/storage-git/src/git-object-storage.ts`
- [ ] `packages/storage-git/src/composite-object-storage.ts`
- [ ] `packages/storage-git/src/git-commit-storage.ts`
- [ ] `packages/storage-git/src/git-file-tree-storage.ts`
- [ ] `packages/storage-git/src/git-tag-storage.ts`
- [ ] `packages/storage-git/src/create-streaming-stores.ts` (deprecated)
- [ ] `packages/vcs/src/interfaces/object-store.ts`

### Files to REFACTOR
- [ ] `packages/storage-git/src/git-pack-storage.ts` → `PackReader`
- [ ] `packages/storage-git/src/git-delta-object-storage.ts` → `DeltaStorage`
- [ ] `packages/storage-git/src/git-repository.ts`
- [ ] `packages/storage-git/src/git-storage.ts`
- [ ] `packages/storage-git/src/typed-object-utils.ts`
- [ ] `packages/sandbox/src/base/default-object-store.ts`

### Files to UPDATE (exports/imports)
- [ ] `packages/storage-git/src/index.ts`
- [ ] `packages/vcs/src/interfaces/index.ts`

### Tests to UPDATE
- [ ] `packages/storage-git/tests/gc/*.test.ts`
- [ ] `packages/storage-git/tests/delta/*.test.ts`
- [ ] `packages/testing/src/suites/object-storage.suite.ts`

---

## Verification Steps

1. **Build check:** `pnpm build`
2. **Type check:** `pnpm exec tsc --noEmit`
3. **Test suite:** `pnpm test`
4. **Lint/format:** `pnpm lint:fix && pnpm format:fix`

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking external users | ObjectStore not in public API (only internal) |
| Pack file reading breaks | Convert GitPackStorage to PackReader carefully |
| Delta compression breaks | Test thoroughly with real Git repositories |
| Factory functions break | Update all factories in same PR |

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Prepare interfaces | Small |
| Phase 2: Remove implementations | Medium |
| Phase 3: Update dependent code | Medium |
| Phase 4: Update factories | Small |
| Phase 5: Remove interface | Small |
| Phase 6: Update tests | Medium |
| Phase 7: Sandbox package | Small |

**Total:** Medium-sized refactoring (1-2 sessions)

---

## Success Criteria

1. No files import `ObjectStore` from `@webrun-vcs/vcs`
2. All tests pass
3. Build succeeds with no type errors
4. Architecture is cleaner: `GitObjectStore` → `RawStore` (2 layers)
