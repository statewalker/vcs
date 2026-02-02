# Phase G: Final Deprecation Removal

## Overview

This plan removes all remaining deprecated code from the codebase. It follows from Phase F1 which removed most deprecated code but kept 37+ items for backward compatibility during the migration period.

**Goal:** Remove ALL `@deprecated` annotations and associated code from the codebase.

**Prerequisites:**
- Phase F complete (F1, F2, F3)
- All tests passing
- No external consumers blocking removal

---

## Scope Analysis

### Remaining Deprecated Items (from F1 audit + architecture docs)

| Category | Count | Complexity |
|----------|-------|------------|
| History Store | 4 | Medium |
| Object Store delete() | 2 | Low |
| Workspace Legacy Interfaces | 9 | High |
| WorkingCopy Legacy Properties | 3 | High |
| WorkingCopy Constructor Overloads | 3 | Medium |
| Pack Storage Re-exports | 15 | Low |
| GitRepository | 2 | Low |
| Utils Compression | 3 | Low |
| Transport Adapters | 4 | Medium |
| Testing Interfaces | 8 | Low |
| **TOTAL** | **53** | |

---

## Phase G1: Core Package Cleanup

### G1.1: Remove History Store Legacy Interfaces

**Files:**
- `packages/core/src/history/history-store.ts`

**Items to remove:**
- `HistoryStore` interface
- `HistoryStoreConfig` interface
- `createHistoryStore()` function
- `GitStores` type

**Migration required:**
- Update `WorkingCopy.repository` to use `History` instead of `HistoryStore`
- Update all consumers to use `WorkingCopy.history`

**Blockers:**
- WorkingCopy.repository property

---

### G1.2: Remove Object Store delete() Method

**Files:**
- `packages/core/src/history/objects/object-store.ts`
- `packages/core/src/history/objects/object-store.impl.ts`

**Items to remove:**
- `GitObjectStore.delete()` method (keep only `remove()`)

**Migration required:**
- Search and replace `store.delete(` → `store.remove(`
- Verify all consumers use `remove()`

---

### G1.3: Remove Workspace Legacy Type Aliases

**Files:**
- `packages/core/src/workspace/staging/types.ts`
- `packages/core/src/workspace/worktree/types.ts`
- `packages/core/src/workspace/checkout/types.ts`

**Items to remove:**
- `StagingStore` type alias → use `Staging`
- `StagingBuilder` type alias → use `IndexBuilder`
- `StagingEditor` type alias → use `IndexEditor`
- `WorktreeStore` type alias → use `Worktree`
- `CheckoutStore` type alias → use `Checkout`

**Migration required:**
- Update all imports to use new names
- Update JSDoc references

---

### G1.4: Refactor WorkingCopy Interface

**Files:**
- `packages/core/src/workspace/working-copy.ts`
- `packages/core/src/workspace/working-copy/working-copy.files.ts`
- `packages/core/src/workspace/working-copy/working-copy.memory.ts`

**Items to change:**
1. Remove `WorkingCopy.repository` property (uses HistoryStore)
2. Rename `WorkingCopy.worktree` → keep as main property (was worktreeInterface)
3. Rename `WorkingCopy.staging` → keep as main property
4. Remove legacy constructor overloads

**New interface:**
```typescript
interface WorkingCopy {
  readonly history: History;
  readonly checkout: Checkout;
  readonly staging: Staging;
  readonly worktree: Worktree;
  readonly stash?: Stash;
}
```

**Migration required:**
- All consumers using `.repository` must use `.history`
- All consumers using old constructors must use options object

---

### G1.5: Remove Pack Storage Re-exports

**Files:**
- `packages/core/src/storage/pack/index.ts`

**Items to remove:**
- All re-exports from `storage/pack/` that point to `backend/git/pack/`

**Migration required:**
- Update imports: `@statewalker/vcs-core/storage/pack` → `@statewalker/vcs-core/backend/git/pack`

---

### G1.6: Remove GitRepository

**Files:**
- `packages/core/src/stores/create-repository.ts`

**Items to remove:**
- `createGitRepository()` function
- `GitRepository` class

**Migration required:**
- Update tests to use `createHistoryFromBackend()` or `createMemoryHistory()`

---

## Phase G2: Utils Package Cleanup

### G2.1: Remove Compression Legacy Names

**Files:**
- `packages/utils/src/compression/types.ts`
- `packages/utils/src/compression/index.ts`

**Items to remove:**
- `CompressionImplementation` type → use `CompressionUtils`
- `setCompression()` function → use `setCompressionUtils()`

**Migration required:**
- Search and replace across codebase

---

## Phase G3: Transport Package Cleanup

### G3.1: Remove Transport Adapter Legacy Params

**Files:**
- `packages/transport-adapters/src/vcs-repository-access.ts`
- `packages/transport-adapters/src/vcs-repository-facade.ts`

**Items to remove:**
- `VcsRepositoryAccessParams` type → use `VcsRepositoryAccessConfig`
- `VcsRepositoryFacadeParams` type → use `VcsRepositoryFacadeConfig`
- Legacy constructor overloads accepting stores instead of History

**Migration required:**
- Update all instantiations to use `{ history }` config

---

## Phase G4: Testing Package Cleanup

### G4.1: Remove Testing Legacy Names

**Files:**
- `packages/testing/src/suites/raw-store.suite.ts`
- `packages/testing/src/tests/simple-history-store.ts`
- `packages/testing/src/tests/mock-worktree-store.ts`

**Items to remove:**
- `RawStoreTestContext` → use `RawStorageTestContext`
- `RawStoreFactory` → use `RawStorageFactory`
- `createRawStoreTests()` → use `createRawStorageTests()`
- `SimpleHistoryStoreOptions` → use `SimpleHistoryOptions`
- `createSimpleHistoryStore()` → use `createSimpleHistory()`
- `SimpleHistoryStore` → use `SimpleHistory`
- `MockWorktreeStore` → use `MockWorktree`
- `createMockWorktreeStore()` → use `createMockWorktree()`

---

## Phase G5: External Package Updates

### G5.1: Update Demo Applications

**Files:**
- `apps/demos/webrtc-p2p-sync/`
- Other demo apps

**Migration required:**
- Update all deprecated API usage to new interfaces

---

### G5.2: Update Store Packages

**Files:**
- `packages/store-mem/`
- `packages/store-sql/`
- `packages/store-kv/`

**Migration required:**
- Remove deprecated factory functions
- Update to new interface names

---

## Task Dependency Graph

```
G1.3 (Workspace types)     G2.1 (Utils)
       ↓                       ↓
G1.4 (WorkingCopy) ──────► G5.1 (Demos)
       ↓                       ↓
G1.1 (HistoryStore) ─────► G5.2 (Stores)
       ↓
G1.6 (GitRepository)
       ↓
G1.2 (delete→remove)
       ↓
G1.5 (Pack re-exports)
       ↓
G3.1 (Transport)
       ↓
G4.1 (Testing)
```

---

## Epic Structure

### Main Epic: `webrun-vcs-g0001` - Phase G: Final Deprecation Removal

#### Sub-Epics:
1. `webrun-vcs-g1xxx` - [G1] Core Package Deprecation Removal
2. `webrun-vcs-g2xxx` - [G2] Utils Package Deprecation Removal
3. `webrun-vcs-g3xxx` - [G3] Transport Package Deprecation Removal
4. `webrun-vcs-g4xxx` - [G4] Testing Package Deprecation Removal
5. `webrun-vcs-g5xxx` - [G5] External Package Updates

---

## Success Criteria

1. `grep -r "@deprecated" packages/` returns zero results
2. No union types accepting both old and new interfaces
3. No re-export files for backward compatibility
4. `pnpm typecheck` passes
5. `pnpm test` passes (all packages)
6. `pnpm lint` passes

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking external consumers | Document migration guide, provide grace period |
| Test failures | Fix tests before removing deprecated code |
| Hidden dependencies | Comprehensive grep/search before removal |
| Merge conflicts | Complete in single sprint, coordinate with team |

---

## Estimated Effort

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| G1 | 6 | 4-6 hours |
| G2 | 1 | 1 hour |
| G3 | 1 | 1-2 hours |
| G4 | 1 | 1-2 hours |
| G5 | 2 | 2-3 hours |
| **Total** | **11** | **9-14 hours** |

---

## Execution Order

1. **Preparation**: Audit all deprecated items, document current usage
2. **G1.3**: Remove workspace type aliases (enables G1.4)
3. **G1.4**: Refactor WorkingCopy (most impactful, enables G1.1)
4. **G2.1**: Remove utils compression legacy (parallel with G1)
5. **G1.1**: Remove HistoryStore (enables G1.6)
6. **G1.6**: Remove GitRepository
7. **G1.2**: Remove delete() method
8. **G1.5**: Remove pack re-exports
9. **G5.1**: Update demos (after G1.4)
10. **G5.2**: Update store packages
11. **G3.1**: Remove transport legacy
12. **G4.1**: Remove testing legacy
13. **Final**: Verification and documentation update
