# 04-branching-merging

Deep dive into Git branch operations and merge strategies using the statewalker-vcs Commands API. This example walks through branch creation, HEAD management, fast-forward and three-way merges, merge strategies, conflict handling, and rebase concepts -- all using in-memory storage.

## Quick Start

```bash
# From the monorepo root
pnpm install
pnpm --filter @statewalker/vcs-example-04-branching-merging start
```

## Running Individual Steps

Each step can be run independently:

```bash
pnpm --filter @statewalker/vcs-example-04-branching-merging step:01  # Branch creation
pnpm --filter @statewalker/vcs-example-04-branching-merging step:02  # HEAD management
pnpm --filter @statewalker/vcs-example-04-branching-merging step:03  # Fast-forward merge
pnpm --filter @statewalker/vcs-example-04-branching-merging step:04  # Three-way merge
pnpm --filter @statewalker/vcs-example-04-branching-merging step:05  # Merge strategies
pnpm --filter @statewalker/vcs-example-04-branching-merging step:06  # Conflict handling
pnpm --filter @statewalker/vcs-example-04-branching-merging step:07  # Rebase concepts
```

## What You'll Learn

- How to create and list branches with the porcelain API
- How HEAD works as a symbolic ref and how to switch branches
- When fast-forward merges happen and how to control them
- How three-way merges create merge commits with multiple parents
- Choosing between RECURSIVE, OURS, THEIRS, and UNION merge strategies
- Detecting and understanding merge conflicts via staging area stages
- The tradeoffs between merge and rebase for integrating changes

## Prerequisites

- Node.js 18+
- pnpm
- Completed [02-porcelain-commands](../02-porcelain-commands/)

---

## Step-by-Step Guide

### Step 1: Branch Creation

**File:** [src/steps/01-branch-creation.ts](src/steps/01-branch-creation.ts)

Creating and listing branches with the porcelain API, plus low-level ref inspection.

```typescript
// Create a branch
const branch = await git.branchCreate().setName("feature").call();

// Create from specific commit
await git.branchCreate()
  .setName("release")
  .setStartPoint(commitId)
  .call();

// List all branches
const branches = await git.branchList().call();
```

**Key APIs:**
- `git.branchCreate()` - Create a new branch, optionally from a specific start point
- `git.branchList()` - List all local branches
- `history.refs.list()` - Low-level iteration over refs by prefix

---

### Step 2: HEAD Management

**File:** [src/steps/02-head-management.ts](src/steps/02-head-management.ts)

Understanding symbolic refs, switching branches at the ref level, and detached HEAD state.

```typescript
// HEAD is typically a symbolic ref
const head = await store.refs.get("HEAD");
// { target: "refs/heads/main" }

// Resolve to get the actual commit
const resolved = await store.refs.resolve("HEAD");
// { objectId: "abc123..." }

// Switch branches (low-level)
await store.refs.setSymbolic("HEAD", "refs/heads/feature");

// Create detached HEAD
await store.refs.set("HEAD", commitId);
```

**Key APIs:**
- `refs.get()` - Read a ref value (symbolic or direct)
- `refs.resolve()` - Follow symbolic refs to get the final object ID
- `refs.setSymbolic()` - Point HEAD at a branch
- `refs.set()` - Point HEAD directly at a commit (detached)

---

### Step 3: Fast-Forward Merge

**File:** [src/steps/03-fast-forward.ts](src/steps/03-fast-forward.ts)

When one branch is directly ahead of another, Git can simply move the branch pointer forward without creating a merge commit.

```typescript
// Fast-forward is automatic when possible
const result = await git.merge().include("feature").call();
// result.status === MergeStatus.FAST_FORWARD

// Force merge commit (no fast-forward)
await git.merge()
  .include("feature")
  .setFastForwardMode(FastForwardMode.NO_FF)
  .call();

// Fail if fast-forward not possible
await git.merge()
  .include("feature")
  .setFastForwardMode(FastForwardMode.FF_ONLY)
  .call();
```

**Key APIs:**
- `git.merge().include()` - Specify the branch to merge
- `MergeStatus.FAST_FORWARD` - Result status for fast-forward merges
- `FastForwardMode.FF` / `NO_FF` / `FF_ONLY` - Control fast-forward behavior

---

### Step 4: Three-Way Merge

**File:** [src/steps/04-three-way-merge.ts](src/steps/04-three-way-merge.ts)

When branches have diverged from a common ancestor, a three-way merge compares both sides against the merge base and creates a merge commit with two parents.

```typescript
const result = await git.merge().include("feature").call();

if (result.status === MergeStatus.MERGED) {
  // Merge commit created with two parents
  const commit = await store.commits.loadCommit(result.newHead);
  console.log(commit.parents); // [mainCommitId, featureCommitId]
}
```

**Key APIs:**
- `MergeStatus.MERGED` - Result status for three-way merges
- `result.newHead` - The object ID of the new merge commit
- `result.mergeBase` - The common ancestor used for comparison

---

### Step 5: Merge Strategies

**File:** [src/steps/05-merge-strategies.ts](src/steps/05-merge-strategies.ts)

Different strategies for different situations: tree-level strategies control which side wins entirely, while content strategies resolve individual file conflicts.

```typescript
// OURS: Keep our tree, record merge
await git.merge()
  .include("feature")
  .setStrategy(MergeStrategy.OURS)
  .call();

// THEIRS: Replace with their tree
await git.merge()
  .include("feature")
  .setStrategy(MergeStrategy.THEIRS)
  .call();

// Content strategies for file-level conflicts
await git.merge()
  .include("feature")
  .setContentMergeStrategy(ContentMergeStrategy.UNION)
  .call();
```

**Key APIs:**
- `MergeStrategy.RECURSIVE` - Default three-way merge algorithm
- `MergeStrategy.OURS` / `MergeStrategy.THEIRS` - Tree-level strategy override
- `ContentMergeStrategy.UNION` - Concatenate both sides for additive files

---

### Step 6: Conflict Handling

**File:** [src/steps/06-conflict-handling.ts](src/steps/06-conflict-handling.ts)

Understanding merge conflicts: when they occur, how the staging area represents them with stages 1-3, and strategies for resolution.

```typescript
const result = await git.merge().include("feature").call();

if (result.status === MergeStatus.CONFLICTING) {
  console.log("Conflicts in:", result.conflicts);

  // Staging area contains conflict stages:
  // Stage 0: Merged (clean)
  // Stage 1: BASE (common ancestor)
  // Stage 2: OURS (current branch)
  // Stage 3: THEIRS (incoming branch)
}
```

**Key APIs:**
- `MergeStatus.CONFLICTING` - Result status when conflicts are detected
- `result.conflicts` - List of conflicting file paths
- `checkout.staging.entries()` - Iterate staging entries to inspect conflict stages

---

### Step 7: Rebase Concepts

**File:** [src/steps/07-rebase-concepts.ts](src/steps/07-rebase-concepts.ts)

Understanding the conceptual difference between merge and rebase, including when to use each approach and safety considerations for shared branches.

```typescript
// Rebase replays feature commits on top of main
await git.rebase().setUpstream("main").call();

// Before:  main ---A---B---C
//                   \
// feature:           D---E
//
// After:   main ---A---B---C
//                            \
// feature:                    D'---E'
```

**Key APIs:**
- `git.rebase().setUpstream()` - Specify the branch to rebase onto
- Rebase creates new commits (D', E') with different hashes than the originals

---

## Key Concepts

### Branch Diagrams

**Fast-Forward:**
```
Before:  main ---o
                  \
         feature   o---o

After:   main --------o---o (fast-forward)
```
Fast-forward moves the branch pointer forward along a linear path. No merge commit is needed because one branch is a direct ancestor of the other.

**Three-Way Merge:**
```
Before:  main ---o---o
                  \
         feature   o---o

After:   main ---o---o---M (merge commit)
                  \     /
         feature   o---o
```
When both branches have diverged, a merge commit (M) is created with two parents, combining the histories.

### Merge Strategy Reference

| Scenario | Strategy | Effect |
|----------|----------|--------|
| Normal merge | `RECURSIVE` (default) | Three-way comparison against common ancestor |
| Ignore their changes | `MergeStrategy.OURS` | Keep our tree entirely, record merge in history |
| Accept their version | `MergeStrategy.THEIRS` | Replace our tree with theirs, record merge |
| Additive files (changelogs) | `ContentMergeStrategy.UNION` | Concatenate both sides |
| Conflicting config files | `ContentMergeStrategy.OURS` / `THEIRS` | Pick one side at file level |

### Merge vs Rebase

| Aspect | Merge | Rebase |
|--------|-------|--------|
| History | Preserves branches | Linear history |
| Commit IDs | Unchanged | Rewritten |
| Safety | Safe for shared branches | Local branches only |
| Use case | Feature completion | Keeping up with main |

Rebase rewrites history by replaying commits on a new base, producing a cleaner linear log. However, it should never be used on commits that have been shared with others, because rewriting published history causes divergence for anyone who based work on the original commits.

---

## Project Structure

```
apps/examples/04-branching-merging/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── main.ts                       # Main entry point (runs all steps)
    ├── shared.ts                     # Shared utilities and helpers
    └── steps/
        ├── 01-branch-creation.ts     # Branch creation and listing
        ├── 02-head-management.ts     # HEAD and symbolic refs
        ├── 03-fast-forward.ts        # Fast-forward merge
        ├── 04-three-way-merge.ts     # Three-way merge with diverged branches
        ├── 05-merge-strategies.ts    # OURS, THEIRS, UNION strategies
        ├── 06-conflict-handling.ts   # Conflict detection and resolution
        └── 07-rebase-concepts.ts     # Rebase vs merge concepts
```

---

## Output Example

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║               statewalker-vcs: Branching and Merging Example                 ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

============================================================
  Step 1: Branch Creation
============================================================

--- Step 1: Branch Creation ---

Setting up initial commit...
  Created initial commit

--- Creating branches with git.branchCreate() ---

Creating 'feature' branch...
  Created branch: feature

Creating 'develop' branch...
  Created branch: develop

Creating 'release' branch from specific commit...
  Created branch: release at a1b2c3d

--- Listing branches with git.branchList() ---

  All branches:
    - develop
    - feature
    - main
    - release

  Total branches: 4

Step 1 completed!

============================================================
  Step 2: HEAD Management
============================================================

--- Step 2: HEAD Management ---

--- Understanding HEAD ---

HEAD is a special ref that points to your current branch.
  Resolved HEAD:
    Symbolic ref: refs/heads/main
    Commit: a1b2c3d

--- Switching branches (low-level) ---

Switching to 'feature' branch via refs.setSymbolic()...
  HEAD now points to: refs/heads/feature

--- Detached HEAD State ---

Creating detached HEAD state...
  Symbolic ref: none (detached)
  Points to: a1b2c3d

Returning to 'main' branch...

Step 2 completed!
...
```

---

## API Reference Links

| Interface | Location | Purpose |
|-----------|----------|---------|
| `Git` | [packages/commands/src/git.ts](../../../packages/commands/src/git.ts) | Main porcelain API facade |
| `BranchCommand` | [packages/commands/src/commands/branch-command.ts](../../../packages/commands/src/commands/branch-command.ts) | Branch create/list/delete operations |
| `MergeCommand` | [packages/commands/src/commands/merge-command.ts](../../../packages/commands/src/commands/merge-command.ts) | Merge with strategy and fast-forward options |
| `RebaseCommand` | [packages/commands/src/commands/rebase-command.ts](../../../packages/commands/src/commands/rebase-command.ts) | Rebase onto upstream branch |
| `MergeResult` | [packages/commands/src/results/merge-result.ts](../../../packages/commands/src/results/merge-result.ts) | Merge status, conflicts, and new HEAD |
| `RefStore` | [packages/core/src/history/refs/ref-store.ts](../../../packages/core/src/history/refs/ref-store.ts) | Low-level ref read/write (HEAD, branches) |
| `WorkingCopy` | [packages/core/src/workspace/working-copy.ts](../../../packages/core/src/workspace/working-copy.ts) | Composite workspace (history + checkout + worktree) |

---

## Next Steps

- [05-history-operations](../05-history-operations/) - Log, diff, blame, and history traversal
- [07-staging-checkout](../07-staging-checkout/) - Staging area internals and checkout operations
