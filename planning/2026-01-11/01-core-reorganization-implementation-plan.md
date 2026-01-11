# Core Package Reorganization - Implementation Plan

## Overview

This plan implements **Strategy 1: In-Place Reorganization** from the analysis notes.

**Goal:** Reorganize `packages/core/src/` from 20+ flat folders into 4 logical layers:
- `common/` - Shared types and utilities
- `storage/` - Binary storage abstraction
- `history/` - Immutable history (commits, trees, blobs, tags, refs)
- `workspace/` - Working tree + checkout state

**Scope:** 141 files across 23 directories → 4 top-level layers

**Consuming packages to update:** 8 packages
- @statewalker/vcs-commands
- @statewalker/vcs-transport
- @statewalker/vcs-testing
- @statewalker/vcs-sandbox
- @statewalker/vcs-store-mem
- @statewalker/vcs-store-kv
- @statewalker/vcs-store-sql
- @statewalker/vcs-storage-tests

---

## Final Structure

```
packages/core/src/
├── common/                      # Shared types and utilities (8 files)
│   ├── id/
│   │   ├── index.ts
│   │   └── object-id.ts
│   ├── format/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   └── person-ident.ts
│   ├── person/
│   │   ├── index.ts
│   │   └── person-ident.ts
│   ├── files/
│   │   └── index.ts
│   └── index.ts
│
├── storage/                     # Binary storage layer (46 files)
│   ├── binary/                  # 8 files
│   │   └── [raw-store, volatile-store implementations]
│   ├── pack/                    # 14 files
│   │   └── [pack reader/writer/indexer]
│   ├── delta/                   # 24 files (includes 4 subfolders)
│   │   ├── candidate-finder/    # 5 files
│   │   ├── compressor/          # 2 files
│   │   ├── strategy/            # 2 files
│   │   ├── engine/              # 2 files
│   │   └── [13 root files]
│   └── index.ts
│
├── history/                     # Immutable history (34 files)
│   ├── objects/                 # 5 files (NO index.ts currently)
│   ├── commits/                 # 4 files
│   ├── trees/                   # 5 files
│   ├── blobs/                   # 2 files (renamed from blob/)
│   ├── tags/                    # 4 files
│   ├── refs/                    # 13 files
│   ├── history-store.ts
│   └── index.ts
│
├── workspace/                   # Working tree + checkout (40 files)
│   ├── worktree/                # 3 files (keep name - matches interface)
│   ├── staging/                 # 7 files
│   ├── status/                  # 5 files
│   ├── checkout/                # 4 files (keep name - matches interface)
│   ├── working-copy/            # 15 files
│   ├── ignore/                  # 5 files
│   ├── working-copy.ts
│   └── index.ts
│
├── stores/                      # Factory functions (keep at root)
│   ├── index.ts
│   └── create-repository.ts
│
└── index.ts                     # Main exports
```

**Removed from core (moved to other packages):**
- `commands/` → packages/commands/src/core-commands/
- `repository-access/` → packages/transport/src/repository-access/

---

## Important: No Interface Renames Required

**Verification confirmed:** The existing interface names are correct and should NOT be renamed:
- `WorktreeStore` - Part 2 of three-part architecture ✓
- `WorktreeEntry` - Entry type for worktree ✓
- `CheckoutStore` - Part 3 of three-part architecture ✓
- `CheckoutStoreConfig` - Config for CheckoutStore ✓

These names are already documented in the public API (`packages/commands/src/types.ts`):
```typescript
export interface GitStoresConfig {
  readonly history: HistoryStore;      // Part 1
  readonly checkout?: CheckoutStore;   // Part 3
  readonly worktree?: WorktreeStore;   // Part 2
}
```

**Only folder organization changes are needed, not interface renames.**

---

## Implementation Phases

### Phase 0: Preparation
- [ ] Create beads issues for tracking
- [ ] Ensure all tests pass before starting
- [ ] Create git branch: `refactor/core-reorganization`

### Phase 1: Create common/ layer
### Phase 2: Create storage/ layer
### Phase 3: Create history/ layer
### Phase 4: Create workspace/ layer
### Phase 5: Move transversal code out of core
### Phase 6: Update main index.ts
### Phase 7: Update consuming packages
### Phase 8: Final cleanup

---

## Phase 1: Create common/ Layer

**Files to move:** 8 files from 4 folders
**Files that will need import updates:** ~70 files

### 1.1 Create folder structure
```bash
mkdir -p packages/core/src/common/{id,format,person,files}
```

### 1.2 Move files

| Source | Destination |
|--------|-------------|
| `id/index.ts` | `common/id/index.ts` |
| `id/object-id.ts` | `common/id/object-id.ts` |
| `format/index.ts` | `common/format/index.ts` |
| `format/types.ts` | `common/format/types.ts` |
| `format/person-ident.ts` | `common/format/person-ident.ts` |
| `person/index.ts` | `common/person/index.ts` |
| `person/person-ident.ts` | `common/person/person-ident.ts` |
| `files/index.ts` | `common/files/index.ts` |

### 1.3 Exported types

**From id/:**
- `ObjectId` (type alias: string)
- `ObjectInfo` (type with id and size)
- `GitFormat` (constants)

**From person/:**
- `PersonIdent` (interface)

**From format/:**
- `formatPersonIdent()`, `parsePersonIdent()`, `createPersonIdent()`
- `CommitEntry`, `TagEntry` (types)

**From files/:**
- Re-exports from `@statewalker/vcs-utils/files`: `FileMode`, `FileModeValue`, `FilesApi`, etc.

### 1.4 Internal dependency
- `format/person-ident.ts` imports from `../person/person-ident.js`
- `format/types.ts` imports from `../person/person-ident.js`
- After move: `../person/` → `./person/` (same common/ layer)

### 1.5 Create common/index.ts
```typescript
export * from "./id/index.js";
export * from "./format/index.js";
export * from "./person/index.js";
export * from "./files/index.js";
```

### 1.6 Update imports (70 files)

**Files importing from id/ (54 files):**
- All files in: objects/, commits/, trees/, blob/, tags/, refs/
- All files in: staging/, status/, worktree/, checkout/, working-copy/
- Files in: delta/, pack/, stores/, commands/, repository-access/
- Root: index.ts, working-copy.ts, history-store.ts

**Files importing from files/ (27 files):**
- trees/tree-entry.ts, trees/tree-format.ts
- binary/volatile-store.files.ts, binary/raw-store.files.ts
- worktree/worktree-store.ts, worktree/worktree-store.impl.ts
- staging/, status/, refs/, pack/, commands/

**Files importing from format/ (7 files):**
- tags/tag-format.ts
- refs/reflog-reader.ts, refs/reflog-writer.ts
- commits/commit-format.ts
- index.ts

**Files importing from person/ (8 files):**
- tags/tag-store.ts
- refs/reflog-writer.ts, refs/reflog-types.ts
- commits/commit-store.ts
- format/types.ts, format/person-ident.ts
- working-copy/stash-store.files.ts
- index.ts

### 1.7 Delete old folders
```bash
rm -rf packages/core/src/{id,format,person,files}
```

### 1.8 Validation
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes in core package
- [ ] Commit: `refactor(core): create common/ layer`

---

## Phase 2: Create storage/ Layer

**Files to move:** 46 files from 3 folders (including delta subfolders)

### 2.1 Folder structure (delta has subfolders)

```
storage/
├── binary/                      # 8 files
│   ├── index.ts
│   ├── raw-store.ts
│   ├── raw-store.memory.ts
│   ├── raw-store.files.ts
│   ├── raw-store.compressed.ts
│   ├── volatile-store.ts
│   ├── volatile-store.memory.ts
│   └── volatile-store.files.ts
│
├── pack/                        # 14 files
│   ├── index.ts
│   ├── types.ts
│   ├── pack-delta-store.ts
│   ├── pack-directory.ts
│   ├── pack-consolidator.ts
│   ├── pack-reader.ts
│   ├── pack-writer.ts
│   ├── pack-indexer.ts
│   ├── pack-index-reader.ts
│   ├── pack-index-writer.ts
│   ├── pack-entries-parser.ts
│   ├── pending-pack.ts
│   ├── delta-reverse-index.ts
│   └── varint.ts
│
├── delta/                       # 24 files total
│   ├── index.ts
│   ├── types.ts
│   ├── delta-store.ts
│   ├── delta-storage.ts
│   ├── delta-engine.ts
│   ├── delta-compressor.ts
│   ├── delta-decision-strategy.ts
│   ├── delta-binary-format.ts
│   ├── raw-store-with-delta.ts
│   ├── gc-controller.ts
│   ├── storage-analyzer.ts
│   ├── packing-orchestrator.ts
│   ├── candidate-finder.ts
│   │
│   ├── candidate-finder/        # 5 files
│   │   ├── index.ts
│   │   ├── candidate-finder.ts (duplicate name - interface)
│   │   ├── size-similarity-finder.ts
│   │   ├── path-based-finder.ts
│   │   └── commit-tree-finder.ts
│   │
│   ├── compressor/              # 2 files
│   │   ├── index.ts
│   │   └── git-delta-compressor.ts
│   │
│   ├── strategy/                # 2 files
│   │   ├── index.ts
│   │   └── default-delta-decision-strategy.ts
│   │
│   └── engine/                  # 2 files
│       ├── index.ts
│       └── default-delta-engine.ts
│
└── index.ts
```

### 2.2 Cross-dependencies within storage layer

**binary → delta:**
- `raw-store.ts` imports `DeltaStore` from `../delta/index.js`

**delta → binary:**
- `raw-store-with-delta.ts` imports `RawStore` from `../binary/raw-store.js`

**delta → pack:**
- `gc-controller.ts` imports `PackConsolidator` from `../pack/pack-consolidator.js`

**pack → delta:**
- `pack-delta-store.ts` imports from `../delta/delta-binary-format.js` and `../delta/delta-store.js`

After move, these become:
- `./binary/` ↔ `./delta/` ↔ `./pack/` (within same storage/ layer)

### 2.3 Create storage/index.ts
```typescript
export * from "./binary/index.js";
export * from "./pack/index.js";
export * from "./delta/index.js";
```

### 2.4 Update imports

**Files importing from binary/:**
- objects/object-store.impl.ts
- stores/create-repository.ts

**Files importing from pack/:**
- delta/gc-controller.ts
- stores/create-repository.ts

**Files importing from delta/:**
- binary/raw-store.ts
- stores/create-repository.ts
- history-store.ts

### 2.5 Move commands
```bash
# Move entire folders with subfolders preserved
mv packages/core/src/binary packages/core/src/storage/
mv packages/core/src/pack packages/core/src/storage/
mv packages/core/src/delta packages/core/src/storage/
```

### 2.6 Validation
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes in core package
- [ ] Commit: `refactor(core): create storage/ layer`

---

## Phase 3: Create history/ Layer

**Files to move:** 34 files from 7 folders + 1 root file

### 3.1 File inventory

```
history/
├── objects/                     # 5 files (need to create index.ts)
│   ├── index.ts (NEW)
│   ├── object-store.ts
│   ├── object-store.impl.ts
│   ├── object-types.ts
│   ├── object-header.ts
│   └── load-with-header.ts
│
├── commits/                     # 4 files
│   ├── index.ts (FIX: remove blob/objects re-exports)
│   ├── commit-store.ts
│   ├── commit-store.impl.ts
│   └── commit-format.ts
│
├── trees/                       # 5 files
│   ├── index.ts
│   ├── tree-store.ts
│   ├── tree-store.impl.ts
│   ├── tree-format.ts
│   └── tree-entry.ts
│
├── blobs/                       # 2 files (renamed from blob/)
│   ├── index.ts (NEW)
│   ├── blob-store.ts
│   └── blob-store.impl.ts
│
├── tags/                        # 4 files
│   ├── index.ts
│   ├── tag-store.ts
│   ├── tag-store.impl.ts
│   └── tag-format.ts
│
├── refs/                        # 13 files
│   ├── index.ts
│   ├── ref-store.ts
│   ├── ref-store.files.ts
│   ├── ref-store.memory.ts
│   ├── ref-types.ts
│   ├── ref-reader.ts
│   ├── ref-writer.ts
│   ├── ref-directory.ts
│   ├── packed-refs-reader.ts
│   ├── packed-refs-writer.ts
│   ├── reflog-types.ts
│   ├── reflog-reader.ts
│   └── reflog-writer.ts
│
├── history-store.ts
└── index.ts
```

### 3.2 Issue to fix: commits/index.ts

Current `commits/index.ts` has improper re-exports:
```typescript
// CURRENT (problematic):
export * from "../blob/blob-store.impl.js";
export * from "../blob/blob-store.js";
export * from "../objects/object-store.impl.js";
export * from "../objects/object-store.js";
```

**Fix:** Remove these re-exports. Each folder should only export its own content.

### 3.3 Create missing index.ts files

**Create objects/index.ts:**
```typescript
export * from "./object-store.js";
export * from "./object-store.impl.js";
export * from "./object-types.js";
export * from "./object-header.js";
export * from "./load-with-header.js";
```

**Create blobs/index.ts:**
```typescript
export * from "./blob-store.js";
export * from "./blob-store.impl.js";
```

### 3.4 Cross-dependencies within history layer

All typed stores depend on `objects/`:
- `commits/commit-store.impl.ts` → `../objects/object-store.js`
- `trees/tree-store.impl.ts` → `../objects/object-store.js`
- `blobs/blob-store.impl.ts` → `../objects/object-store.js`
- `tags/tag-store.impl.ts` → `../objects/object-store.js`, `../objects/object-types.js`
- `tags/tag-format.ts` → `../objects/object-header.js`

After move: `../objects/` → `./objects/` (within same history/ layer)

### 3.5 Create history/index.ts
```typescript
export * from "./objects/index.js";
export * from "./commits/index.js";
export * from "./trees/index.js";
export * from "./blobs/index.js";
export * from "./tags/index.js";
export * from "./refs/index.js";
export * from "./history-store.js";
```

### 3.6 Files importing from history layer (38+ files)

**External consumers:**
- stores/create-repository.ts
- status/status-calculator.impl.ts
- status/index-diff-calculator.ts
- staging/staging-store.ts, staging-store.files.ts, staging-store.memory.ts
- working-copy/checkout-utils.ts, checkout-conflict-detector.ts, stash-store.files.ts
- commands/checkout.command.impl.ts, add.command.impl.ts
- repository-access/git-serializers.ts, serializing-repository-access.ts
- delta/gc-controller.ts, packing-orchestrator.ts, raw-store-with-delta.ts
- delta/candidate-finder/commit-tree-finder.ts

### 3.7 Move commands
```bash
mkdir -p packages/core/src/history
mv packages/core/src/objects packages/core/src/history/
mv packages/core/src/commits packages/core/src/history/
mv packages/core/src/trees packages/core/src/history/
mv packages/core/src/blob packages/core/src/history/blobs  # rename
mv packages/core/src/tags packages/core/src/history/
mv packages/core/src/refs packages/core/src/history/
mv packages/core/src/history-store.ts packages/core/src/history/
```

### 3.8 Validation
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes in core package
- [ ] Commit: `refactor(core): create history/ layer`

---

## Phase 4: Create workspace/ Layer

**Files to move:** 40 files from 6 folders + 1 root file
**No interface renames needed**

### 4.1 File inventory

```
workspace/
├── worktree/                    # 3 files (keep folder name)
│   ├── index.ts
│   ├── worktree-store.ts        # WorktreeStore interface
│   └── worktree-store.impl.ts
│
├── staging/                     # 7 files
│   ├── index.ts
│   ├── staging-store.ts         # StagingStore interface
│   ├── staging-store.files.ts
│   ├── staging-store.memory.ts
│   ├── index-format.ts
│   ├── staging-edits.ts
│   └── conflict-utils.ts
│
├── status/                      # 5 files
│   ├── index.ts
│   ├── status-calculator.ts     # StatusCalculator interface
│   ├── status-calculator.impl.ts
│   ├── index-diff.ts
│   └── index-diff-calculator.ts
│
├── checkout/                    # 4 files (keep folder name)
│   ├── index.ts
│   ├── checkout-store.ts        # CheckoutStore interface
│   ├── checkout-store.files.ts
│   └── checkout-store.memory.ts
│
├── working-copy/                # 15 files
│   ├── index.ts
│   ├── working-copy.files.ts
│   ├── working-copy.memory.ts
│   ├── working-copy-factory.files.ts
│   ├── working-copy-config.files.ts
│   ├── stash-store.files.ts
│   ├── stash-store.memory.ts
│   ├── repository-state.ts
│   ├── repository-state-detector.ts
│   ├── checkout-utils.ts
│   ├── checkout-conflict-detector.ts
│   ├── merge-state-reader.ts
│   ├── rebase-state-reader.ts
│   ├── cherry-pick-state-reader.ts
│   └── revert-state-reader.ts
│
├── ignore/                      # 5 files
│   ├── index.ts
│   ├── ignore-manager.ts
│   ├── ignore-manager.impl.ts
│   ├── ignore-node.ts
│   └── ignore-rule.ts
│
├── working-copy.ts              # WorkingCopy interface (facade)
└── index.ts
```

### 4.2 Key interfaces (NO RENAMES)

**Part 2 - WorktreeStore:**
- `WorktreeStore` - filesystem access interface
- `WorktreeEntry` - file/directory entry
- `WorktreeStoreOptions` - iteration options

**Part 3 - CheckoutStore:**
- `CheckoutStore` - local mutable state interface
- `CheckoutStoreConfig` - configuration
- `StagingStore` - staging area (linked)
- `StashStore` - stash storage (linked)

**Facade - WorkingCopy:**
- `WorkingCopy` - combines HistoryStore + WorktreeStore + CheckoutStore
- Used for convenience, not required for three-part architecture

### 4.3 Cross-dependencies within workspace layer

**checkout → staging:**
- `checkout-store.ts` imports `StagingStore` from `../staging/staging-store.js`
- `checkout-store.files.ts` imports from `../staging/`

**status → staging, worktree, trees:**
- `status-calculator.impl.ts` imports from all three

**working-copy → all others:**
- Orchestrates worktree, staging, checkout, status

After move: All `../` paths become `./` within workspace layer

### 4.4 Create workspace/index.ts
```typescript
export * from "./worktree/index.js";
export * from "./staging/index.js";
export * from "./status/index.js";
export * from "./checkout/index.js";
export * from "./working-copy/index.js";
export * from "./ignore/index.js";
export * from "./working-copy.js";
```

### 4.5 Files importing from workspace layer (50+ files)

**Core internal:**
- checkout/checkout-store.ts → staging/
- status/status-calculator.impl.ts → staging/, worktree/, history/trees/
- working-copy/* → staging/, worktree/, checkout/, status/, history/

**Commands package (11+ files):**
- types.ts, add-command.ts, checkout-command.ts, commit-command.ts
- status-command.ts, reset-command.ts, rm-command.ts, clean-command.ts

**Testing & apps:**
- testing/src/suites/staging-store.suite.ts
- apps/example-*/

### 4.6 Move commands
```bash
mkdir -p packages/core/src/workspace
mv packages/core/src/worktree packages/core/src/workspace/
mv packages/core/src/staging packages/core/src/workspace/
mv packages/core/src/status packages/core/src/workspace/
mv packages/core/src/checkout packages/core/src/workspace/
mv packages/core/src/working-copy packages/core/src/workspace/
mv packages/core/src/ignore packages/core/src/workspace/
mv packages/core/src/working-copy.ts packages/core/src/workspace/
```

### 4.7 Validation
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes in core package
- [ ] Commit: `refactor(core): create workspace/ layer`

---

## Phase 5: Move Transversal Code Out of Core

### 5.1 Move commands/ to packages/commands

**Source:** `packages/core/src/commands/`
**Destination:** `packages/commands/src/core-commands/`

Files (5):
- `index.ts`
- `add.command.ts`
- `add.command.impl.ts`
- `checkout.command.ts`
- `checkout.command.impl.ts`

### 5.2 Move repository-access/ to packages/transport

**Source:** `packages/core/src/repository-access/`
**Destination:** `packages/transport/src/repository-access/`

Files (5):
- `index.ts`
- `repository-access.ts`
- `git-native-repository-access.ts`
- `serializing-repository-access.ts`
- `git-serializers.ts`

### 5.3 Update package exports

**packages/commands/package.json:**
- Add export for core-commands

**packages/transport/package.json:**
- Add export for repository-access

### 5.4 Delete from core
```bash
rm -rf packages/core/src/{commands,repository-access}
```

### 5.5 Validation
- [ ] `pnpm build` passes across all packages
- [ ] `pnpm test` passes across all packages
- [ ] Commit: `refactor(core): move transversal code to appropriate packages`

---

## Phase 6: Update Main index.ts

### 6.1 Rewrite packages/core/src/index.ts

```typescript
// Layer exports
export * from "./common/index.js";
export * from "./storage/index.js";
export * from "./history/index.js";
export * from "./workspace/index.js";

// Factory functions
export * from "./stores/index.js";
```

### 6.2 Optional: Add subpath exports to package.json

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./common": "./dist/common/index.js",
    "./storage": "./dist/storage/index.js",
    "./history": "./dist/history/index.js",
    "./workspace": "./dist/workspace/index.js"
  }
}
```

### 6.3 Validation
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] Commit: `refactor(core): update main exports`

---

## Phase 7: Update Consuming Packages

### 7.1 Packages to update

| Package | Import Changes |
|---------|----------------|
| @statewalker/vcs-commands | Update moved command imports |
| @statewalker/vcs-transport | Now owns repository-access |
| @statewalker/vcs-testing | Path updates only |
| @statewalker/vcs-sandbox | Path updates only |
| @statewalker/vcs-store-mem | Path updates only |
| @statewalker/vcs-store-kv | Path updates only |
| @statewalker/vcs-store-sql | Path updates only |
| @statewalker/vcs-storage-tests | Path updates only |

### 7.2 Import changes

All imports from `@statewalker/vcs-core` continue to work (flat re-exports preserved).

**For internal paths (if any):**
- `../blob/` → from `@statewalker/vcs-core` or `@statewalker/vcs-core/history`
- `../worktree/` → from `@statewalker/vcs-core` or `@statewalker/vcs-core/workspace`

### 7.3 Validation per package
- [ ] `pnpm build` passes for each package
- [ ] `pnpm test` passes for each package
- [ ] Commit per package: `refactor(package-name): update core imports`

---

## Phase 8: Final Cleanup

### 8.1 Run full validation
```bash
pnpm build
pnpm test
pnpm lint:fix
pnpm format:fix
```

### 8.2 Verify no old imports remain
```bash
# Should return no results
grep -r "from ['\"]\.\./(id|format|person|files|binary|pack|delta|objects|commits|trees|blob|tags|refs|worktree|staging|status|checkout|ignore|working-copy)/" packages/core/src/
```

### 8.3 Verify folder structure
```bash
# Should only show: common, storage, history, workspace, stores
ls packages/core/src/
```

### 8.4 Final commit
```
refactor(core): complete reorganization to layered structure

Organized packages/core/src/ into 4 logical layers:
- common/ - Shared types (ObjectId, PersonIdent, FileMode)
- storage/ - Binary storage (raw, pack, delta)
- history/ - Immutable history (commits, trees, blobs, tags, refs)
- workspace/ - Working tree (worktree, staging, status, checkout)

Moved transversal code:
- commands/ → packages/commands
- repository-access/ → packages/transport
```

---

## Summary: What Changes vs What Stays Same

### Folder Changes

| Old Location | New Location |
|--------------|--------------|
| `id/` | `common/id/` |
| `format/` | `common/format/` |
| `person/` | `common/person/` |
| `files/` | `common/files/` |
| `binary/` | `storage/binary/` |
| `pack/` | `storage/pack/` |
| `delta/` | `storage/delta/` |
| `objects/` | `history/objects/` |
| `commits/` | `history/commits/` |
| `trees/` | `history/trees/` |
| `blob/` | `history/blobs/` (pluralized) |
| `tags/` | `history/tags/` |
| `refs/` | `history/refs/` |
| `history-store.ts` | `history/history-store.ts` |
| `worktree/` | `workspace/worktree/` |
| `staging/` | `workspace/staging/` |
| `status/` | `workspace/status/` |
| `checkout/` | `workspace/checkout/` |
| `working-copy/` | `workspace/working-copy/` |
| `ignore/` | `workspace/ignore/` |
| `working-copy.ts` | `workspace/working-copy.ts` |
| `commands/` | Removed (→ packages/commands) |
| `repository-access/` | Removed (→ packages/transport) |

### Interface Names (NO CHANGES)

All public interfaces keep their current names:
- `ObjectId`, `PersonIdent`, `FileMode` - common types
- `RawStore`, `DeltaStore`, `PackDeltaStore` - storage interfaces
- `GitObjectStore`, `CommitStore`, `TreeStore`, `BlobStore`, `TagStore`, `RefStore` - history interfaces
- `HistoryStore` - Part 1 facade
- `WorktreeStore`, `WorktreeEntry` - Part 2 interface
- `CheckoutStore`, `CheckoutStoreConfig` - Part 3 interface
- `StagingStore`, `StatusCalculator`, `IgnoreManager` - workspace utilities
- `WorkingCopy` - convenience facade

---

## Risk Mitigation

1. **Test after each phase** - Don't proceed if tests fail
2. **Commit per phase** - Easy rollback if needed
3. **Branch protection** - Work on feature branch
4. **No interface renames** - Reduces breaking changes

---

## Estimated Effort

| Phase | Complexity | Files Moved | Import Updates |
|-------|------------|-------------|----------------|
| Phase 1 (common) | Low | 8 | ~70 |
| Phase 2 (storage) | Medium | 46 | ~20 |
| Phase 3 (history) | Medium | 34 | ~40 |
| Phase 4 (workspace) | Medium | 40 | ~50 |
| Phase 5 (transversal) | Low | 10 | ~30 |
| Phase 6 (index) | Low | 1 | 0 |
| Phase 7 (consumers) | High | 0 | ~100+ |
| Phase 8 (cleanup) | Low | 0 | 0 |

**Total:** ~140 files moved, ~300+ import updates
