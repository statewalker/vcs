# WorkingCopy JGit Migration Implementation Plan

This plan details the migration of key functionalities from JGit to webrun-vcs WorkingCopy implementation, based on the comparative analysis.

## Overview

The migration focuses on three areas:
1. **State Machine** - Repository operation state tracking
2. **Core Operations** - Stash, status calculation, checkout
3. **Test Migration** - Porting JGit test coverage

### Design Philosophy

This plan adapts **JGit algorithms** to **native webrun-vcs interfaces**. We are NOT recreating JGit's class hierarchy.

**What we take from JGit:**
- Algorithm logic (state detection order, three-way diff, stash commit structure)
- File format knowledge (index format, state file locations)
- Test scenarios and edge cases

**What we keep native:**
- `WorkingCopy` interface - our abstraction for checkout state
- `StagingStore` interface - our abstraction for the index
- `Repository` interface - our abstraction for object storage
- Async/Promise patterns throughout
- TypeScript-idiomatic design

### Package Separation

**packages/core** - Low-level primitives and interfaces:
- `working-copy/`: State readers, WorkingCopy interface, StashStore interface
- `staging/`: StagingStore, index format, conflict utilities
- `status/`: IndexDiff calculation, status types
- `commands/`: Interface definitions (Checkout, CheckoutOptions)

**packages/commands** - High-level Git command implementations:
- `stash-create-command.ts`, `stash-apply-command.ts` - use core StashStore
- `checkout-command.ts` - uses core Checkout interface
- `status-command.ts` - uses core StatusCalculator
- `merge-command.ts`, `rebase-command.ts`, etc.

---

## JGit Source References

All algorithms reference JGit source files located at `tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/`.

| Component | JGit Source File | Key Methods/Classes |
|-----------|------------------|---------------------|
| Repository State Enum | `lib/RepositoryState.java` | enum with `canCheckout()`, `canCommit()`, `canAmend()`, `isRebasing()` |
| State Detection | `lib/Repository.java:1302-1370` | `getRepositoryState()` method |
| Index/Staging | `dircache/DirCache.java` | `DirCache` class, `builder()`, `lock()` |
| Index Entry | `dircache/DirCacheEntry.java` | `DirCacheEntry`, stage constants |
| Index Diff | `lib/IndexDiff.java` | `IndexDiff` class, `StageState` enum |
| Stash Create | `api/StashCreateCommand.java:217-380` | `call()` method with TreeWalk |
| Stash Apply | `api/StashApplyCommand.java` | `call()` with `MergeStrategy.RECURSIVE` |
| Three-way Checkout | `dircache/DirCacheCheckout.java` | `DirCacheCheckout`, `checkout()` |
| Status | `api/Status.java` + `api/StatusCommand.java` | `Status` wrapper over `IndexDiff` |

---

## Phase 1: Repository State Machine

Implement a comprehensive state machine for tracking in-progress operations.

**JGit Reference:**
- Enum definition: `lib/RepositoryState.java` (lines 1-392)
- Detection logic: `lib/Repository.java:1302-1370` (`getRepositoryState()` method)

### Step 1.1: Define RepositoryState Enum

Create `packages/core/src/working-copy/repository-state.ts`:

```typescript
/**
 * Repository operation state.
 *
 * Tracks in-progress operations that affect what actions are allowed.
 * Based on JGit's RepositoryState enum.
 */
export const RepositoryState = {
  /** Bare repository - no working tree */
  BARE: "bare",
  /** Normal safe state */
  SAFE: "safe",
  /** Merge in progress with unresolved conflicts */
  MERGING: "merging",
  /** Merge resolved, ready to commit */
  MERGING_RESOLVED: "merging-resolved",
  /** Cherry-pick in progress with conflicts */
  CHERRY_PICKING: "cherry-picking",
  /** Cherry-pick resolved, ready to commit */
  CHERRY_PICKING_RESOLVED: "cherry-picking-resolved",
  /** Revert in progress with conflicts */
  REVERTING: "reverting",
  /** Revert resolved, ready to commit */
  REVERTING_RESOLVED: "reverting-resolved",
  /** Rebase in progress (git am style) */
  REBASING: "rebasing",
  /** Rebase in progress (merge strategy) */
  REBASING_MERGE: "rebasing-merge",
  /** Interactive rebase in progress */
  REBASING_INTERACTIVE: "rebasing-interactive",
  /** Git am (apply mailbox) in progress */
  APPLY: "apply",
  /** Bisect in progress */
  BISECTING: "bisecting",
} as const;

export type RepositoryStateValue = (typeof RepositoryState)[keyof typeof RepositoryState];

/**
 * Capability queries for repository state.
 */
export interface StateCapabilities {
  /** Can checkout to another branch/commit */
  canCheckout: boolean;
  /** Can create commits */
  canCommit: boolean;
  /** Can reset HEAD */
  canResetHead: boolean;
  /** Can amend last commit */
  canAmend: boolean;
  /** Is a rebase operation in progress */
  isRebasing: boolean;
}

/**
 * Get capabilities for a repository state.
 */
export function getStateCapabilities(state: RepositoryStateValue): StateCapabilities;
```

### Step 1.2: Implement State Detection

Create `packages/core/src/working-copy/repository-state-detector.ts`:

```typescript
/**
 * Detect current repository state from Git files.
 *
 * Checks for state files in order of priority:
 * 1. rebase-merge/ or rebase-apply/ (rebase states)
 * 2. MERGE_HEAD (merge states)
 * 3. CHERRY_PICK_HEAD (cherry-pick states)
 * 4. REVERT_HEAD (revert states)
 * 5. BISECT_LOG (bisect state)
 */
export async function detectRepositoryState(
  files: StateDetectorFilesApi,
  gitDir: string,
  hasConflicts: boolean,
): Promise<RepositoryStateValue>;
```

State file checks (from JGit `Repository.getRepositoryState()`):

| File/Directory | State |
|----------------|-------|
| `rebase-apply/rebasing` | REBASING |
| `rebase-apply/applying` | APPLY |
| `rebase-apply/` exists | REBASING |
| `rebase-merge/interactive` | REBASING_INTERACTIVE |
| `rebase-merge/` exists | REBASING_MERGE |
| `MERGE_HEAD` + conflicts | MERGING |
| `MERGE_HEAD` no conflicts | MERGING_RESOLVED |
| `CHERRY_PICK_HEAD` + conflicts | CHERRY_PICKING |
| `CHERRY_PICK_HEAD` no conflicts | CHERRY_PICKING_RESOLVED |
| `REVERT_HEAD` + conflicts | REVERTING |
| `REVERT_HEAD` no conflicts | REVERTING_RESOLVED |
| `BISECT_LOG` | BISECTING |
| None of above | SAFE |

### Step 1.3: Update WorkingCopy Interface

Add to `packages/core/src/working-copy.ts`:

```typescript
import type { RepositoryStateValue, StateCapabilities } from "./working-copy/repository-state.js";

export interface WorkingCopy {
  // ... existing methods ...

  /**
   * Get current repository state.
   */
  getState(): Promise<RepositoryStateValue>;

  /**
   * Get capability queries for current state.
   */
  getStateCapabilities(): Promise<StateCapabilities>;
}
```

### Step 1.4: Add Cherry-Pick and Revert State Readers

Create `packages/core/src/working-copy/cherry-pick-state-reader.ts`:

```typescript
export interface CherryPickState {
  /** Commit being cherry-picked */
  readonly cherryPickHead: ObjectId;
  /** Commit message */
  readonly message?: string;
}

export async function readCherryPickState(
  files: FilesApi,
  gitDir: string,
): Promise<CherryPickState | undefined>;
```

Create `packages/core/src/working-copy/revert-state-reader.ts`:

```typescript
export interface RevertState {
  /** Commit being reverted */
  readonly revertHead: ObjectId;
  /** Revert message */
  readonly message?: string;
}

export async function readRevertState(
  files: FilesApi,
  gitDir: string,
): Promise<RevertState | undefined>;
```

---

## Phase 2: Complete Status Calculation

Implement full three-way diff status calculation.

**JGit Reference:**
- `lib/IndexDiff.java` - Three-way diff algorithm and `StageState` enum (lines 67-300)
- `lib/IndexDiff.java:151-171` - `StageState.fromMask()` bitmask logic
- `api/StatusCommand.java` - Command wrapper
- `api/Status.java` - Result container wrapping IndexDiff

**Native webrun-vcs Integration:**
- Builds on existing `StatusCalculator` interface
- Uses native `StagingStore` for index access
- Uses native `WorkingTreeIterator` for filesystem access
- Results returned via existing `RepositoryStatus` interface

### Step 2.1: Add StageState Enum

Update `packages/core/src/status/status-calculator.ts`:

```typescript
/**
 * Detailed conflict stage state.
 * Based on JGit IndexDiff.StageState.
 */
export const StageState = {
  /** Deleted in both ours and theirs */
  BOTH_DELETED: "both-deleted",
  /** Added only in ours */
  ADDED_BY_US: "added-by-us",
  /** Deleted in theirs, exists in base and ours */
  DELETED_BY_THEM: "deleted-by-them",
  /** Added only in theirs */
  ADDED_BY_THEM: "added-by-them",
  /** Deleted in ours, exists in base and theirs */
  DELETED_BY_US: "deleted-by-us",
  /** Added in both with different content */
  BOTH_ADDED: "both-added",
  /** Modified in both with different content */
  BOTH_MODIFIED: "both-modified",
} as const;

export type StageStateValue = (typeof StageState)[keyof typeof StageState];
```

### Step 2.2: Implement IndexDiff

Create `packages/core/src/status/index-diff.ts`:

```typescript
/**
 * Three-way diff between HEAD, index, and working tree.
 * Based on JGit's IndexDiff class.
 */
export interface IndexDiff {
  /** Files added to index (not in HEAD) */
  added: Set<string>;
  /** Files modified in index (different from HEAD) */
  changed: Set<string>;
  /** Files removed from index (in HEAD, not in index) */
  removed: Set<string>;
  /** Files missing from working tree (in index, not on disk) */
  missing: Set<string>;
  /** Files modified in working tree (different from index) */
  modified: Set<string>;
  /** Files not tracked */
  untracked: Set<string>;
  /** Untracked directories */
  untrackedFolders: Set<string>;
  /** Files with conflicts */
  conflicting: Set<string>;
  /** Conflict stage states */
  conflictingStageStates: Map<string, StageStateValue>;
  /** Ignored files not in index */
  ignoredNotInIndex: Set<string>;
}

export interface IndexDiffCalculator {
  /**
   * Calculate diff using TreeWalk pattern.
   *
   * Walks HEAD tree, index, and working tree simultaneously.
   */
  calculate(options?: IndexDiffOptions): Promise<IndexDiff>;
}
```

### Step 2.3: Update StatusCalculator Implementation

Update `packages/core/src/status/status-calculator.impl.ts`:

```typescript
export class DefaultStatusCalculator implements StatusCalculator {
  constructor(
    private readonly workingCopy: WorkingCopy,
    private readonly ignoreManager: IgnoreManager,
  ) {}

  async calculateStatus(options?: StatusOptions): Promise<RepositoryStatus> {
    const indexDiff = await this.calculateIndexDiff(options);

    // Convert IndexDiff to RepositoryStatus
    const files: FileStatusEntry[] = [];

    // Process each category...
    for (const path of indexDiff.added) {
      files.push({ path, indexStatus: FileStatus.ADDED, workTreeStatus: FileStatus.UNMODIFIED });
    }
    // ... etc for other categories

    return {
      branch: await this.workingCopy.getCurrentBranch(),
      head: await this.workingCopy.getHead(),
      files,
      isClean: files.length === 0,
      hasStaged: indexDiff.added.size > 0 || indexDiff.changed.size > 0 || indexDiff.removed.size > 0,
      hasUnstaged: indexDiff.modified.size > 0 || indexDiff.missing.size > 0,
      hasUntracked: indexDiff.untracked.size > 0,
      hasConflicts: indexDiff.conflicting.size > 0,
    };
  }
}
```

---

## Phase 3: Complete Stash Implementation

**JGit Reference:**
- `api/StashCreateCommand.java:217-380` - Main `call()` method showing stash commit structure
- `api/StashCreateCommand.java:227-294` - TreeWalk with HEAD, index, and working tree
- `api/StashCreateCommand.java:165-197` - `updateStashRef()` for reflog management
- `api/StashApplyCommand.java:150-280` - Apply with `MergeStrategy.RECURSIVE`

**Native webrun-vcs Integration:**
- Core `StashStore` in `core/working-copy/` provides primitives (list, drop, clear, reflog)
- Command layer in `commands/stash-create-command.ts` orchestrates full push
- Command layer in `commands/stash-apply-command.ts` orchestrates full apply
- Uses native `Repository.commits` for commit creation
- Uses native `Repository.refs` for refs/stash management
- Uses native `StagingStore.writeTree()` for tree generation

### Step 3.1: Implement Stash Push

The full push implementation lives in `commands/src/commands/stash-create-command.ts`, using core primitives:

```typescript
async push(message?: string): Promise<ObjectId> {
  // 1. Get current HEAD
  const headCommit = await this.repository.refs.resolve("HEAD");
  if (!headCommit) throw new Error("Cannot stash without HEAD");

  // 2. Create tree from current index
  const indexTree = await this.staging.writeTree(this.repository.trees);

  // 3. Create index commit (parent: HEAD)
  const indexCommit = await this.createCommit({
    tree: indexTree,
    parents: [headCommit.objectId],
    message: formatIndexMessage(branchName, headCommit),
  });

  // 4. Create tree from working directory
  const workingTree = await this.createWorkingTreeSnapshot();

  // 5. Create stash commit (parents: HEAD, indexCommit)
  const stashCommit = await this.createCommit({
    tree: workingTree,
    parents: [headCommit.objectId, indexCommit],
    message: message ?? formatWorkingDirMessage(branchName, headCommit),
  });

  // 6. Update refs/stash
  await this.updateStashRef(stashCommit);

  // 7. Reset working directory to HEAD
  await this.resetWorkingDirectory(headCommit);

  return stashCommit;
}
```

### Step 3.2: Implement Stash Apply

```typescript
async apply(index = 0): Promise<void> {
  // 1. Get stash commit
  const stashCommit = await this.getStashCommit(index);
  if (!stashCommit) throw new Error(`stash@{${index}} does not exist`);

  // 2. Get stash tree
  const stashTree = await this.repository.commits.get(stashCommit);

  // 3. Apply tree to working directory
  // Use three-way merge: base=HEAD, ours=working tree, theirs=stash
  await this.applyTreeToWorkingDirectory(stashTree.tree);

  // 4. Optionally restore index state
  if (this.options.restoreIndex) {
    const indexCommit = stashTree.parents[1];
    await this.staging.readTree(this.repository.trees, indexCommit.tree);
  }
}
```

### Step 3.3: Add Untracked Files Support

```typescript
/**
 * Stash with untracked files creates third parent.
 *
 * Parents:
 * - [0]: HEAD commit
 * - [1]: Index state commit
 * - [2]: Untracked files commit (optional)
 */
async push(message?: string, options?: StashPushOptions): Promise<ObjectId> {
  // ... existing logic ...

  if (options?.includeUntracked) {
    // 6. Create untracked files tree
    const untrackedTree = await this.createUntrackedFilesSnapshot();

    // 7. Create untracked commit
    const untrackedCommit = await this.createCommit({
      tree: untrackedTree,
      parents: [],
      message: formatUntrackedMessage(branchName, headCommit),
    });

    // 8. Update stash commit with third parent
    parents.push(untrackedCommit);
  }

  // ... rest of logic ...
}
```

---

## Phase 4: Enhanced Checkout

**JGit Reference:**
- `dircache/DirCacheCheckout.java:78-120` - Class structure and `CheckoutMetadata`
- `dircache/DirCacheCheckout.java` - `checkout()` method for tree application
- `dircache/DirCacheCheckout.java` - Conflict detection using NameConflictTreeWalk
- `api/CheckoutCommand.java` - High-level checkout command

**Native webrun-vcs Integration:**
- Extends existing `CheckoutCommand` in `commands/checkout.command.ts`
- Uses native `WorkingCopy` for HEAD/index access
- Uses native `WorkingTreeIterator` for file operations
- Uses native `StagingStore` for index updates

### Step 4.1: Three-Way Checkout Utilities

Create `packages/core/src/staging/checkout-utils.ts` (primitives used by commands):

```typescript
/**
 * Three-way checkout with conflict detection.
 * Based on JGit's DirCacheCheckout.
 */
export interface ThreeWayCheckoutResult {
  /** Successfully updated paths */
  updated: string[];
  /** Paths with conflicts */
  conflicts: string[];
  /** Paths that would be overwritten */
  toBeDeleted: string[];
  /** Files that failed to update */
  failed: Map<string, Error>;
}

export async function threeWayCheckout(
  workingCopy: WorkingCopy,
  targetTree: ObjectId,
  options?: CheckoutOptions,
): Promise<ThreeWayCheckoutResult>;
```

### Step 4.2: Conflict Detection

```typescript
/**
 * Check if checkout would cause conflicts.
 */
export async function checkConflicts(
  headTree: ObjectId,
  indexTree: ObjectId,
  targetTree: ObjectId,
  workingTree: WorkingTreeIterator,
): Promise<ConflictCheckResult>;

interface ConflictCheckResult {
  /** Can proceed with checkout */
  canCheckout: boolean;
  /** Paths that would be overwritten */
  conflicts: string[];
  /** Paths that need to be deleted */
  toRemove: string[];
}
```

---

## Phase 5: Test Migration

**JGit Test References:**
All tests located at `tmp/jgit/org.eclipse.jgit.test/tst/org/eclipse/jgit/`.

### Step 5.1: DirCache/Staging Tests

**JGit Reference:** `dircache/*Test.java`

Migrate from `org.eclipse.jgit.test/tst/org/eclipse/jgit/dircache/`:

| JGit Test | webrun-vcs Test | Priority |
|-----------|-----------------|----------|
| `DirCacheBasicTest.java` | `staging-store.test.ts` | High |
| `DirCacheBuilderTest.java` | `staging-builder.test.ts` | High |
| `DirCacheEntryTest.java` | `staging-entry.test.ts` | High |
| `DirCacheFindTest.java` | `staging-lookup.test.ts` | High |
| `DirCacheIteratorTest.java` | `staging-iterator.test.ts` | Medium |
| `DirCacheCGitCompatabilityTest.java` | `staging-git-compat.test.ts` | High |

Create `packages/core/tests/staging/`:

```typescript
// staging-store.test.ts
describe("StagingStore", () => {
  describe("basic operations", () => {
    it("should start empty");
    it("should add entries");
    it("should remove entries");
    it("should update entries");
    it("should clear all entries");
  });

  describe("entry lookup", () => {
    it("should find entry by path");
    it("should return undefined for missing path");
    it("should find entry by path and stage");
    it("should list entries under prefix");
  });

  describe("conflict handling", () => {
    it("should detect conflicts");
    it("should list conflict paths");
    it("should get all stages for conflicted path");
  });

  describe("persistence", () => {
    it("should read index file");
    it("should write index file");
    it("should detect outdated index");
  });
});
```

### Step 5.2: Status Tests

**JGit Reference:** `api/StatusCommandTest.java`

Migrate from `org.eclipse.jgit.test/tst/org/eclipse/jgit/api/StatusCommandTest.java`:

```typescript
// status-calculator.test.ts
describe("StatusCalculator", () => {
  describe("clean repository", () => {
    it("should report clean status");
    it("should report no staged changes");
    it("should report no unstaged changes");
  });

  describe("staged changes", () => {
    it("should detect added files");
    it("should detect modified files");
    it("should detect deleted files");
  });

  describe("unstaged changes", () => {
    it("should detect modified working tree files");
    it("should detect missing files");
  });

  describe("untracked files", () => {
    it("should detect untracked files");
    it("should respect gitignore");
  });

  describe("conflicts", () => {
    it("should detect conflicting files");
    it("should report conflict stage state");
  });
});
```

### Step 5.3: Stash Tests

**JGit Reference:**
- `api/StashCreateCommandTest.java`
- `api/StashApplyCommandTest.java`
- `api/StashDropCommandTest.java`
- `api/StashListCommandTest.java`

Migrate from `org.eclipse.jgit.test/tst/org/eclipse/jgit/api/Stash*Test.java`:

```typescript
// stash-store.test.ts
describe("StashStore", () => {
  describe("push", () => {
    it("should create stash commit");
    it("should save index state");
    it("should save working tree state");
    it("should include untracked files when requested");
    it("should reset working directory after stash");
  });

  describe("list", () => {
    it("should list stash entries in order");
    it("should return empty for no stashes");
  });

  describe("apply", () => {
    it("should restore working tree");
    it("should optionally restore index");
    it("should handle conflicts");
  });

  describe("drop", () => {
    it("should remove stash entry");
    it("should update refs/stash");
    it("should throw for invalid index");
  });

  describe("pop", () => {
    it("should apply and drop");
    it("should not drop on apply failure");
  });
});
```

### Step 5.4: Repository State Tests

**JGit Reference:**
- State detection tested indirectly in `api/MergeCommandTest.java`, `api/RebaseCommandTest.java`
- `api/CherryPickCommandTest.java`, `api/RevertCommandTest.java`

```typescript
// repository-state.test.ts
describe("RepositoryState", () => {
  describe("detection", () => {
    it("should detect SAFE state");
    it("should detect MERGING state");
    it("should detect MERGING_RESOLVED state");
    it("should detect CHERRY_PICKING state");
    it("should detect REVERTING state");
    it("should detect REBASING states");
    it("should detect BISECTING state");
  });

  describe("capabilities", () => {
    it("should allow checkout in SAFE state");
    it("should deny checkout in MERGING state");
    it("should allow commit in MERGING_RESOLVED state");
    it("should allow amend in REBASING state");
  });
});
```

---

## Phase 6: Git Compatibility Validation

**JGit Reference:**
- `dircache/DirCacheCGitCompatabilityTest.java` - Git format compatibility tests
- Index format: `dircache/DirCache.java:78-110` - `SIG_DIRC`, version, extensions

### Step 6.1: Index Format Compatibility

Create `packages/core/tests/compat/index-format.test.ts`:

```typescript
describe("Index Format Compatibility", () => {
  it("should read index created by git");
  it("should write index readable by git");
  it("should preserve all entry fields");
  it("should handle extensions correctly");
  it("should compute correct checksum");
});
```

### Step 6.2: State File Compatibility

```typescript
describe("State File Compatibility", () => {
  it("should read MERGE_HEAD created by git");
  it("should read rebase-merge/ created by git");
  it("should read reflog format");
  it("should write compatible state files");
});
```

---

## File Summary

### New Files

**packages/core (Primitives):**

| File | Purpose | JGit Reference |
|------|---------|----------------|
| `core/src/working-copy/repository-state.ts` | State enum and capabilities | `lib/RepositoryState.java` |
| `core/src/working-copy/repository-state-detector.ts` | State detection from files | `lib/Repository.java:1302-1370` |
| `core/src/working-copy/cherry-pick-state-reader.ts` | Cherry-pick state | `lib/Repository.java` CHERRY_PICK_HEAD |
| `core/src/working-copy/revert-state-reader.ts` | Revert state | `lib/Repository.java` REVERT_HEAD |
| `core/src/status/index-diff.ts` | Three-way diff calculation | `lib/IndexDiff.java` |
| `core/src/status/stage-state.ts` | Conflict stage states | `lib/IndexDiff.java:78-171` |
| `core/src/staging/checkout-utils.ts` | Three-way checkout helpers | `dircache/DirCacheCheckout.java` |

**packages/commands (High-level commands):**

| File | Purpose | JGit Reference |
|------|---------|----------------|
| Update `commands/src/commands/stash-create-command.ts` | Complete push impl | `api/StashCreateCommand.java` |
| Update `commands/src/commands/stash-apply-command.ts` | Complete apply impl | `api/StashApplyCommand.java` |
| Update `commands/src/commands/checkout-command.ts` | Three-way checkout | `api/CheckoutCommand.java` |

**Tests:**

| File | Purpose | JGit Reference |
|------|---------|----------------|
| `core/tests/staging/staging-store.test.ts` | Staging tests | `dircache/DirCacheBasicTest.java` |
| `core/tests/staging/staging-builder.test.ts` | Builder tests | `dircache/DirCacheBuilderTest.java` |
| `core/tests/status/status-calculator.test.ts` | Status tests | `api/StatusCommandTest.java` |
| `core/tests/working-copy/stash-store.test.ts` | Stash tests | `api/Stash*Test.java` |
| `core/tests/working-copy/repository-state.test.ts` | State tests | Various command tests |
| `core/tests/compat/index-format.test.ts` | Git compat tests | `dircache/DirCacheCGitCompatabilityTest.java` |

### Modified Files

| File | Changes |
|------|---------|
| `core/src/working-copy.ts` | Add getState(), getStateCapabilities() |
| `core/src/working-copy/index.ts` | Export new modules |
| `core/src/working-copy/working-copy.files.ts` | Implement state methods |
| `core/src/working-copy/stash-store.files.ts` | Core stash primitives |
| `core/src/status/status-calculator.ts` | Add StageState type |
| `core/src/status/status-calculator.impl.ts` | Use IndexDiff |
| `commands/src/commands/stash-create-command.ts` | Full push implementation |
| `commands/src/commands/stash-apply-command.ts` | Full apply implementation |

---

## Implementation Order

### Sprint 1: State Machine (Estimated: 8 tasks)

1. Create `repository-state.ts` with enum and capabilities
2. Create `repository-state-detector.ts`
3. Create `cherry-pick-state-reader.ts`
4. Create `revert-state-reader.ts`
5. Update `working-copy.ts` interface
6. Update `working-copy.files.ts` implementation
7. Create `repository-state.test.ts`
8. Add exports to index.ts

### Sprint 2: Status Calculation (Estimated: 6 tasks)

1. Create `stage-state.ts` enum
2. Create `index-diff.ts` interface
3. Implement IndexDiff calculator
4. Update StatusCalculator to use IndexDiff
5. Create `status-calculator.test.ts`
6. Create conflict stage state tests

### Sprint 3: Stash Completion (Estimated: 5 tasks)

1. Implement `stash.push()` with tree creation
2. Implement `stash.apply()` with tree restoration
3. Add untracked files support
4. Create comprehensive stash tests
5. Test Git compatibility

### Sprint 4: Checkout Enhancement (Estimated: 4 tasks)

1. Create `checkout.three-way.ts`
2. Implement conflict detection
3. Update checkout command
4. Create checkout tests

### Sprint 5: Test Migration (Estimated: 6 tasks)

1. Migrate DirCache basic tests
2. Migrate DirCache builder tests
3. Migrate status command tests
4. Migrate stash command tests
5. Create Git compatibility tests
6. Validate against real Git repositories

---

## Success Criteria

1. **State Machine**: All 14 repository states detected correctly
2. **Status**: Three-way diff matches git status output
3. **Stash**: Push/apply/pop work with Git-created stashes
4. **Checkout**: Three-way checkout handles conflicts correctly
5. **Compatibility**: Read/write index files compatible with Git
6. **Tests**: 90%+ coverage on WorkingCopy functionality
