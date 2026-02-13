# Package Consolidation Plan: Merge into Core

This plan details the removal of four packages by merging their unique functionality into `@statewalker/vcs-core`.

## Packages to Remove

1. **storage-git** - Git-compatible file-based storage
2. **staging** - Staging area (index) implementations
3. **vcs** - Re-export wrapper package
4. **worktree** - Working tree operations

## Analysis Summary

### Already in Core (No Migration Needed)

Core already contains comprehensive implementations for:

| Module | Core Location | Status |
|--------|---------------|--------|
| Binary storage (RawStore, VolatileStore) | `binary/` | Complete |
| Commit storage & format | `commits/` | Complete |
| Delta storage & strategies | `delta/` | Complete |
| Pack files (reader, writer, indexer) | `pack/` | Complete |
| Tree storage & format | `trees/` | Complete |
| Tag storage & format | `tags/` | Complete |
| Ref storage & types | `refs/` | Complete |
| Staging store interface & edits | `staging/` | Complete |
| Staging store implementations | `staging/staging-store.memory.ts`, `staging-store.files.ts` | Complete |
| Ignore manager | `ignore/` | Complete |
| Status calculator | `status/` | Complete |
| Working tree iterator | `worktree/` | Complete |
| Add command | `commands/add.command.ts` | Complete |
| Checkout command | `commands/checkout.command.ts` | Complete |
| Object store interface | `objects/object-store.ts` | Complete |
| Person identity | `person/` | Complete |
| File modes | `files/` | Complete |
| Repository interface | `repository.ts` | Complete |

---

## Package-by-Package Analysis

### 1. storage-git Package

#### Items Already Duplicated in Core

| storage-git | core equivalent | Action |
|-------------|-----------------|--------|
| `GitCommitStorage` | `CommitStoreImpl` | Already in core |
| `GitFileTreeStorage` | `TreeStoreImpl` | Already in core |
| `GitTagStorage` | `TagStoreImpl` | Already in core |
| `GitObjectStorage` | `GitObjectStoreImpl` | Already in core |
| `GitRefStorage` | `RefStore` interface + implementations | Already in core |
| `PackReader`, `PackWriter`, etc. | `pack/` module | Already in core |
| `FileStagingStore` | `FileStagingStore` in core | Already in core |
| Delta strategies | `delta/strategies/` | Already in core |
| `GCController` | `delta/gc-controller.ts` | Already in core |
| `StorageAnalyzer` | `delta/storage-analyzer.ts` | Already in core |
| `PackingOrchestrator` | `delta/packing-orchestrator.ts` | Already in core |
| Format utilities | `format/`, `commits/commit-format.ts`, etc. | Already in core |

#### Items to Migrate (Unique to storage-git)

| Class/Function | Description | Target Location |
|----------------|-------------|-----------------|
| `GitRepository` | High-level repository with initialization | `core/repository/` (new) |
| `createGitRepository()` | Factory function | `core/repository/` |
| `GitStorage` | Combined storage interface | `core/storage/` (new) |
| `createGitStorage()` | Factory function | `core/storage/` |
| `CompositeObjectStorage` | Multi-backend object storage | `core/objects/` |
| `GitRawObjectStorage` | Loose object storage (DEPRECATED) | Skip - use core's implementation |
| `GitPackStorage` | Pack file storage | Already covered by PackDirectory |
| `GitDeltaObjectStorage` | Delta+pack storage (DEPRECATED) | Skip - use RawStoreWithDelta |
| `CheckoutCommand` | Checkout implementation | Already in core as `CheckoutCommandImpl` |
| `FileTreeIterator` | File tree iteration | Already in core as `WorkingTreeIteratorImpl` |

#### Migration Tasks for storage-git

1. **GitRepository/GitStorage** - These are convenience wrappers. Evaluate if they add value beyond what core already provides. If needed:
   - Create `core/repository/git-repository.ts`
   - Create `core/repository/git-storage.ts`
   - Add factory functions

2. **CompositeObjectStorage** - Useful for combining loose + pack storage:
   - Migrate to `core/objects/composite-object-storage.ts`

3. **Deprecated items** - Do NOT migrate:
   - `GitRawObjectStorage` - Use `FileRawStore` from core
   - `GitDeltaObjectStorage` - Use `RawStoreWithDelta` from core
   - Old format utilities - Already in core

---

### 2. staging Package

#### Analysis

The staging package contains:
- Re-exports of types from `@statewalker/vcs-core/staging`
- `MemoryStagingStore` - In-memory staging implementation

#### Items in Core

| staging | core equivalent | Status |
|---------|-----------------|--------|
| `StagingStore` interface | `staging/staging-store.ts` | Already in core |
| `StagingEntry`, `StagingEntryOptions` | `staging/staging-store.ts` | Already in core |
| `StagingBuilder`, `StagingEditor` | `staging/staging-store.ts` | Already in core |
| `StagingEdit` classes | `staging/staging-edits.ts` | Already in core |
| `MergeStage` constants | `staging/staging-store.ts` | Already in core |
| `MemoryStagingStore` | `staging/staging-store.memory.ts` | Already in core |
| `FileStagingStore` | `staging/staging-store.files.ts` | Already in core |

#### Migration Tasks for staging

**None required.** The staging package is purely a re-export of core functionality plus `MemoryStagingStore` which already exists in core at `staging/staging-store.memory.ts`.

---

### 3. vcs Package

#### Analysis

The vcs package is a **re-export wrapper** that provides a unified public API. It exports:
- Everything from `@statewalker/vcs-core`
- One unique interface: `ObjectStore` (minimal storage contract)

#### Items Unique to vcs

| Item | Description | Action |
|------|-------------|--------|
| `ObjectStore` interface | Minimal content-addressable storage | Migrate to core |

The `ObjectStore` interface in vcs:
```typescript
interface ObjectStore {
  store(data: AsyncIterable<Uint8Array>): Promise<ObjectId>;
  load(id: ObjectId, params?: { offset?: number; length?: number }): AsyncIterable<Uint8Array>;
  getSize(id: ObjectId): Promise<number>;
  has(id: ObjectId): Promise<boolean>;
  delete(id: ObjectId): Promise<boolean>;
  listObjects(): AsyncGenerator<ObjectId>;
}
```

#### Migration Tasks for vcs

1. **ObjectStore interface** - Check if it differs from `RawStore` in core:
   - Core's `RawStore` has similar methods but uses `store(key, data)` pattern
   - vcs's `ObjectStore` returns the key from `store(data)` (content-addressable)
   - **Decision**: This is effectively the same as `GitObjectStore` in core
   - **Action**: No migration needed - consumers should use `GitObjectStore` from core

---

### 4. worktree Package

#### Analysis

The worktree package provides working tree operations with:
- Add command
- Status calculator
- Working tree iterator
- Ignore manager
- Checkout interfaces

#### Items in Core

| worktree | core equivalent | Status |
|----------|-----------------|--------|
| `AddCommand` / `AddCommandImpl` | `commands/add.command.ts` | Already in core |
| `StatusCalculator` / `StatusCalculatorImpl` | `status/status-calculator.ts` | Already in core |
| `WorkingTreeIterator` / `WorkingTreeIteratorImpl` | `worktree/working-tree-iterator.ts` | Already in core |
| `IgnoreManager` / `IgnoreManagerImpl` | `ignore/ignore-manager.ts` | Already in core |
| `Checkout` interface | `commands/checkout.command.ts` | Already in core |
| All status types | `status/status-calculator.ts` | Already in core |
| All ignore types | `ignore/ignore-manager.ts` | Already in core |

#### Migration Tasks for worktree

**None required.** All functionality already exists in core:
- `core/commands/add.command.ts` + `add.command.impl.ts`
- `core/commands/checkout.command.ts` + `checkout.command.impl.ts`
- `core/status/status-calculator.ts` + `status-calculator.impl.ts`
- `core/worktree/working-tree-iterator.ts` + `working-tree-iterator.impl.ts`
- `core/ignore/ignore-manager.ts` + `ignore-manager.impl.ts`

---

## Final Migration Checklist

### Items to Migrate to Core

| Source | Item | Target | Priority |
|--------|------|--------|----------|
| storage-git | `GitRepository` class | `core/repository/git-repository.ts` | P2 - Optional |
| storage-git | `createGitRepository()` | `core/repository/git-repository.ts` | P2 - Optional |
| storage-git | `GitStorage` class | `core/storage/git-storage.ts` | P2 - Optional |
| storage-git | `createGitStorage()` | `core/storage/git-storage.ts` | P2 - Optional |
| storage-git | `CompositeObjectStorage` | `core/objects/composite-object-storage.ts` | P3 - Low |

### Items to NOT Migrate (Deprecated/Duplicate)

| Source | Item | Reason |
|--------|------|--------|
| storage-git | `GitRawObjectStorage` | DEPRECATED - use `FileRawStore` |
| storage-git | `GitPackStorage` | Covered by `PackDirectory` + `PackReader` |
| storage-git | `GitDeltaObjectStorage` | DEPRECATED - use `RawStoreWithDelta` |
| storage-git | All format utilities | Already in core |
| staging | All items | Pure re-exports of core |
| vcs | `ObjectStore` interface | Use `GitObjectStore` from core |
| worktree | All items | Already in core |

---

## Implementation Phases

### Phase 1: Verification (P0)

1. Verify all claimed duplicates actually exist and work correctly in core
2. Run tests for each package to understand coverage
3. Identify any consumers of these packages

### Phase 2: Optional Migrations (P2)

If `GitRepository` and `GitStorage` provide value:

1. Create `core/repository/git-repository.ts`:
   - `class GitRepository implements Repository`
   - `function createGitRepository()`

2. Create `core/storage/git-storage.ts`:
   - `class GitStorage`
   - `function createGitStorage()`

3. Update `core/index.ts` to export new modules

### Phase 3: Consumer Updates (P1)

1. Update all imports in consumer packages:
   - `transport` package
   - `demo` package
   - Any external consumers

2. Replace:
   - `@webrun-vcs/storage-git` → `@statewalker/vcs-core`
   - `@webrun-vcs/staging` → `@statewalker/vcs-core`
   - `@webrun-vcs/vcs` → `@statewalker/vcs-core`
   - `@webrun-vcs/worktree` → `@statewalker/vcs-core`

### Phase 4: Package Removal (P1)

1. Remove packages from workspace:
   ```bash
   rm -rf packages/storage-git
   rm -rf packages/staging
   rm -rf packages/vcs
   rm -rf packages/worktree
   ```

2. Update `pnpm-workspace.yaml`

3. Update root `package.json` if needed

4. Run full test suite

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking external consumers | High | Publish deprecation notices, provide migration guide |
| Missing functionality in core | Medium | Thorough testing before removal |
| Test coverage gaps | Medium | Run all package tests, ensure core tests cover same cases |

---

## Decision Points

1. **GitRepository/GitStorage**: Are these convenience wrappers worth migrating, or should consumers use core primitives directly?
   - **Recommendation**: Skip migration. Core provides all building blocks.

2. **CompositeObjectStorage**: Is this pattern needed?
   - **Recommendation**: Skip. `RawStoreWithDelta` already handles loose+pack.

3. **Migration timeline**: Gradual or immediate?
   - **Recommendation**: Immediate. All functionality is already in core.

---

## Conclusion

**All four packages can be removed without any migrations.** The core package already contains complete implementations of all required functionality. The packages to be removed are either:
- Pure re-exports (`vcs`, `staging`)
- Deprecated implementations (`storage-git` old classes)
- Already migrated (`worktree` commands, `storage-git` modern classes)

### Recommended Action

1. Update consumer packages to import from `@statewalker/vcs-core`
2. Delete the four packages
3. Update workspace configuration
4. Run full test suite
