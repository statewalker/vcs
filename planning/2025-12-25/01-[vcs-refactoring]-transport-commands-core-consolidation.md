# Transport & Commands Package Consolidation Plan

## Overview

This plan details how to refactor the `transport` and `commands` packages to use the `core` package for all VCS-specific types and interfaces, while maintaining the current functionality. No code will be moved into core - only import paths will be changed and core's exports will be expanded.

**Target architecture:**
- `transport` → depends on `core` + `utils`
- `commands` → depends on `core` + `transport` + `utils`

**Note:** Importing from `@webrun-vcs/utils` is acceptable for hash, compression, and diff utilities. The focus is on consolidating VCS-specific types (stores, refs, repository, etc.) in core.

## Current State Analysis

### Transport Package Dependencies

Currently imports from:
- `@webrun-vcs/core`: `CommitStore`, `GitObjectStore`, `ObjectTypeCode`, `ObjectTypeString`, `Ref`, `RefStore`, `RefStoreLocation`, `RefUpdateResult`, `SymbolicRef`, `TagStore`, `TreeEntry`, `TreeStore`, `Repository`
- `@webrun-vcs/utils`:
  - `compressBlock`, `decompressBlockPartial` (compression)
  - `sha1` (hashing)
  - `bytesToHex`, `hexToBytes` (from `hash/utils`)

**Files using @webrun-vcs/utils:**
- `handlers/receive-pack-handler.ts` - `decompressBlockPartial`, `bytesToHex`
- `handlers/upload-pack-handler.ts` - `compressBlock`, `sha1`
- `handlers/protocol-v2-handler.ts` - dynamic import of `compressBlock`, `sha1`
- `negotiation/ref-advertiser.ts` - `hexToBytes`, `bytesToHex`
- `negotiation/push-negotiator.ts` - `bytesToHex`
- `negotiation/fetch-negotiator.ts` - `bytesToHex`
- `operations/fetch.ts` - `bytesToHex`
- `protocol/ack-nak.ts` - `bytesToHex`, `hexToBytes`

### Commands Package Dependencies

Currently imports from:
- `@webrun-vcs/core`: `ObjectId`, `Ref`, `SymbolicRef`, `Commit`, `PersonIdent`, `Tree`, `Blob`, `Tag`, `FileMode`, `MergeStage`, `BlobStore`, `TreeStore`, `CommitStore`, `RefStore`, `TagStore`, `Repository`, `isSymbolicRef()`
- `@webrun-vcs/transport`: `Credentials`, `ProgressInfo`, `push()`, `fetch()`, `clone()`, transport types
- `@webrun-vcs/utils`:
  - `bytesToHex`, `hexToBytes` (hash utilities)
  - `MyersDiff`, `RawText`, `RawTextComparator`, `EditList` (diff utilities)
- `@webrun-vcs/worktree`:
  - `StagingStore`, `WorkingTreeIterator` (interfaces)
  - `UpdateStagingEntry`, `DeleteStagingEntry` (staging edits)

**Files using @webrun-vcs/utils:**
- `commands/fetch-command.ts` - `bytesToHex`, `hexToBytes`
- `commands/clone-command.ts` - `bytesToHex`
- `results/diff-formatter.ts` - `MyersDiff`, `RawText`, `RawTextComparator`, `EditList`

**Files using @webrun-vcs/worktree:**
- `types.ts` - `StagingStore`, `WorkingTreeIterator`
- `commands/add-command.ts` - full worktree imports
- `commands/checkout-command.ts` - `DeleteStagingEntry`, `UpdateStagingEntry`
- `commands/commit-command.ts` - `WorkingTreeIterator`

### Core Package Current Exports

Main `index.ts` only exports:
- `./binary/index.js`
- `./files/index.js`
- `./id/index.js`
- `./staging/index.js`

**Modules available but NOT exported:**
- `refs/` - RefStore, Ref, SymbolicRef, RefStoreLocation, RefUpdateResult
- `commits/` - CommitStore, BlobStore, GitObjectStore
- `trees/` - TreeStore, TreeEntry
- `tags/` - TagStore
- `format/` - PersonIdent, CommitEntry, TagEntry, ObjectTypeCode
- `objects/` - ObjectType, ObjectTypeCode, ObjectTypeString
- `worktree/` - WorkingTreeIterator (interface only)
- `repository.ts` - Repository interface

---

## Phase 1: Expand Core Package Exports

### Task 1.1: Reorganize Core Index Exports

Update `packages/core/src/index.ts` to export all modules needed by transport and commands.

**Add exports:**
```typescript
// Repository interface
export * from "./repository.js";

// Object types
export * from "./objects/object-types.js";

// Stores
export * from "./blob/blob-store.js";
export * from "./commits/commit-store.js";
export * from "./trees/tree-store.js";
export * from "./trees/tree-entry.js";
export * from "./tags/tag-store.js";

// References
export * from "./refs/ref-types.js";
export * from "./refs/ref-store.js";

// Format types
export * from "./format/person-ident.js";
export * from "./format/types.js";

// Working tree interface
export * from "./worktree/working-tree-iterator.js";
```

### Task 1.2: Keep Utils as Direct Dependency

Transport and commands will import utilities directly from `@webrun-vcs/utils`:
- Hash utilities: `bytesToHex`, `hexToBytes`, `sha1` from `@webrun-vcs/utils`
- Compression: `compressBlock`, `decompressBlockPartial` from `@webrun-vcs/utils`
- Diff utilities: `MyersDiff`, `RawText`, `RawTextComparator` from `@webrun-vcs/utils`

No re-exports needed from core.

### Task 1.3: Integrate Worktree Types into Core

Core already has `worktree/working-tree-iterator.ts` with the `WorkingTreeIterator` interface. The staging types from the standalone `worktree` package need to be accessible.

**Approach:** Core already has `staging/` module. Verify it exports what commands needs:
- `StagingStore` interface
- `UpdateStagingEntry`, `DeleteStagingEntry` types

If missing, add to staging module.

### Task 1.4: Update Core Package.json

Verify core's dependencies include `@webrun-vcs/utils` and that exports are correctly configured for any new sub-exports.

---

## Phase 2: Update Transport Package

### Task 2.1: Update Storage Adapter Imports

**Files to update:**
- `storage-adapters/repository-adapter.ts`
- `storage-adapters/vcs-repository-adapter.ts`

Ensure all VCS types are imported from core's main export:
```typescript
import {
  CommitStore,
  GitObjectStore,
  ObjectTypeCode,
  ObjectTypeString,
  Ref,
  RefStore,
  RefStoreLocation,
  RefUpdateResult,
  Repository,
  SymbolicRef,
  TagStore,
  TreeEntry,
  TreeStore,
} from "@webrun-vcs/core";
```

**Note:** Utils imports (`bytesToHex`, `compressBlock`, etc.) remain from `@webrun-vcs/utils`.

### Task 2.2: Update Transport Tests

**Files to update:**
- `storage-adapter.test.ts`
- `vcs-repository-adapter.test.ts`

Update VCS type imports to use `@webrun-vcs/core`. Utils imports remain from `@webrun-vcs/utils`.

### Task 2.3: Verify Transport Build and Tests

Run:
```bash
pnpm --filter @webrun-vcs/transport build
pnpm --filter @webrun-vcs/transport test
```

---

## Phase 3: Update Commands Package

### Task 3.1: Update Core Type Imports

**Files to update (sample):**
- `git-command.ts` - ObjectId, Ref, SymbolicRef
- `types.ts` - BlobStore, CommitStore, RefStore, Repository, etc.
- `git.ts` - Repository types
- All command files in `commands/`

Ensure all VCS types come from `@webrun-vcs/core`. Utils imports (`bytesToHex`, `MyersDiff`, etc.) remain from `@webrun-vcs/utils`.

### Task 3.2: Replace Worktree Imports with Core

**Files to update:**
- `types.ts`
- `commands/add-command.ts`
- `commands/checkout-command.ts`
- `commands/commit-command.ts`

Change:
```typescript
// From
import { StagingStore, WorkingTreeIterator } from "@webrun-vcs/worktree";
import { UpdateStagingEntry, DeleteStagingEntry } from "@webrun-vcs/worktree";

// To
import {
  StagingStore,
  WorkingTreeIterator,
  UpdateStagingEntry,
  DeleteStagingEntry
} from "@webrun-vcs/core";
```

### Task 3.3: Update Commands Package.json

```json
{
  "dependencies": {
    "@webrun-vcs/core": "workspace:*",
    "@webrun-vcs/transport": "workspace:*",
    "@webrun-vcs/utils": "workspace:*"
    // Remove: "@webrun-vcs/worktree": "workspace:*"
  }
}
```

**Note:** `@webrun-vcs/utils` remains as a dependency.

### Task 3.4: Update Commands Test Infrastructure

**Files to update:**
- `test-helper.ts`
- `backend-factories.ts`
- `transport-test-helper.ts`
- All `*.test.ts` files

Update imports to use `@webrun-vcs/core` for types and `@webrun-vcs/transport` for transport operations.

**Note:** Dev dependencies for test backends (`@webrun-vcs/store-mem`, `@webrun-vcs/store-sql`, `@webrun-vcs/storage-git`) remain as devDependencies since they're only used in tests.

### Task 3.5: Verify Commands Build and Tests

Run:
```bash
pnpm --filter @webrun-vcs/commands build
pnpm --filter @webrun-vcs/commands test
```

---

## Phase 4: Test Improvements

### Task 4.1: Add Integration Tests for Import Paths

Create tests that verify the import structure works correctly:
- Test that transport can import everything it needs from core
- Test that commands can import everything from core + transport

### Task 4.2: Add Type-only Import Tests

Ensure TypeScript compilation works correctly with the new import structure. Create test files that import all public types.

### Task 4.3: Verify No Circular Dependencies

Run a circular dependency check to ensure the new import structure doesn't create cycles:
```bash
pnpm exec madge --circular packages/*/src/index.ts
```

### Task 4.4: Update Test Documentation

Update any test documentation to reflect the new import patterns.

---

## Phase 5: Cleanup and Verification

### Task 5.1: Remove Unused Package Dependencies

After all updates, verify no unused workspace dependencies remain.

### Task 5.2: Full Monorepo Build Verification

```bash
pnpm build
pnpm test
pnpm lint
```

### Task 5.3: Update Package Documentation

Update README files to reflect the new dependency structure.

---

## Risk Mitigation

### Breaking Changes
- The public API should remain unchanged
- Only internal import paths change
- Tests should catch any regressions

### Rollback Plan
- Git commit each phase separately
- If issues arise, revert to previous commit

### Testing Strategy
- Run tests after each file change
- Build verification after each package update
- Full integration test at the end

---

## Summary

| Package | Before | After |
|---------|--------|-------|
| transport | core + utils | core + utils |
| commands | core + transport + utils + worktree | core + transport + utils |

**Key changes:**
- `@webrun-vcs/utils` remains as a direct dependency (acceptable)
- `@webrun-vcs/worktree` is replaced by core exports
- All VCS types (stores, refs, repository) come from core

**Total tasks:** ~18 implementation tasks across 5 phases
**Estimated files to modify:** ~40 files
