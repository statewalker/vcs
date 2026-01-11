# 02-porcelain-commands

Complete Git workflow using the Commands API (porcelain layer). This example demonstrates high-level Git operations that mirror familiar git commands like `commit`, `branch`, `checkout`, `merge`, `log`, `diff`, `status`, `tag`, and `stash`.

## Quick Start

```bash
# From the monorepo root
pnpm install
pnpm --filter @statewalker/vcs-examples-02-porcelain-commands start
```

## Running Individual Steps

Each step can be run independently:

```bash
pnpm --filter @statewalker/vcs-examples-02-porcelain-commands step:01  # Init and commit
pnpm --filter @statewalker/vcs-examples-02-porcelain-commands step:02  # Branching
pnpm --filter @statewalker/vcs-examples-02-porcelain-commands step:03  # Checkout
pnpm --filter @statewalker/vcs-examples-02-porcelain-commands step:04  # Merge
pnpm --filter @statewalker/vcs-examples-02-porcelain-commands step:05  # Log and diff
pnpm --filter @statewalker/vcs-examples-02-porcelain-commands step:06  # Status
pnpm --filter @statewalker/vcs-examples-02-porcelain-commands step:07  # Tags
pnpm --filter @statewalker/vcs-examples-02-porcelain-commands step:08  # Stash
```

## What You'll Learn

- Initialize repositories with the Commands API
- Stage files and create commits
- Create, list, and delete branches
- Checkout branches (switch between branches)
- Merge branches with different strategies
- View commit history and diffs
- Check repository status
- Create lightweight and annotated tags
- Use stash operations

## Prerequisites

- Node.js 18+
- pnpm
- Completed [01-quick-start](../01-quick-start/)

---

## Step-by-Step Guide

### Step 1: Initialize and Commit

**File:** [src/steps/01-init-and-commit.ts](src/steps/01-init-and-commit.ts)

Create a repository and make commits using the Commands API.

```typescript
import { createGitStore, Git } from "@statewalker/vcs-commands";
import { createGitRepository } from "@statewalker/vcs-core";
import { MemoryStagingStore } from "@statewalker/vcs-store-mem";

// Create repository with staging area
const repository = await createGitRepository();
const staging = new MemoryStagingStore();
const store = createGitStore({ repository, staging });

// Create Git facade
const git = Git.wrap(store);

// Create commit
const commitResult = await git.commit()
  .setMessage("Initial commit")
  .call();
```

**Key APIs:**
- `Git.wrap()` - Create the Git facade from a GitStore
- `git.commit()` - Create a commit from staged changes
- `createGitStore()` - Combine repository with staging area

---

### Step 2: Branching

**File:** [src/steps/02-branching.ts](src/steps/02-branching.ts)

Create, list, and delete branches.

```typescript
// Create a branch
await git.branchCreate().setName("feature").call();

// List branches
const branches = await git.branchList().call();
for (const branch of branches) {
  console.log(`- ${branch.name}`);
}

// Delete a branch
await git.branchDelete().setBranchNames("bugfix").call();
```

**Key APIs:**
- `git.branchCreate()` - Create a new branch
- `git.branchList()` - List all branches
- `git.branchDelete()` - Delete branches

---

### Step 3: Checkout

**File:** [src/steps/03-checkout.ts](src/steps/03-checkout.ts)

Switch between branches and create new branches on checkout.

```typescript
// Checkout existing branch
const result = await git.checkout().setName("feature").call();
console.log(`Checkout status: ${result.status}`);

// Create and checkout a new branch in one step
await git.checkout()
  .setCreateBranch(true)
  .setName("new-feature")
  .call();
```

**Key APIs:**
- `git.checkout()` - Switch branches
- `.setName()` - Target branch name
- `.setCreateBranch(true)` - Create branch if it doesn't exist

---

### Step 4: Merge

**File:** [src/steps/04-merge.ts](src/steps/04-merge.ts)

Merge branches using different strategies.

```typescript
import { MergeStrategy } from "@statewalker/vcs-commands";

// Fast-forward merge
const ffResult = await git.merge().include("merge-demo").call();
console.log(`Merge status: ${ffResult.status}`);

// Three-way merge with strategy
const threeWayResult = await git.merge()
  .include("branch-a")
  .setStrategy(MergeStrategy.RECURSIVE)
  .call();
```

**Merge Strategies:**
| Strategy | Description |
|----------|-------------|
| `MergeStrategy.RECURSIVE` | Default three-way merge |
| `MergeStrategy.OURS` | Keep our changes on conflict |
| `MergeStrategy.THEIRS` | Keep their changes on conflict |

**Key APIs:**
- `git.merge()` - Merge branches
- `.include()` - Branch to merge
- `.setStrategy()` - Merge strategy

---

### Step 5: Log and Diff

**File:** [src/steps/05-log-diff.ts](src/steps/05-log-diff.ts)

View commit history and compare changes between commits.

```typescript
// View commit log
const commits = await git.log()
  .setMaxCount(10)
  .call();

for (const commit of commits) {
  console.log(`${commit.message}`);
}

// Diff between commits
const diffEntries = await git.diff()
  .setOldTree(oldCommitId)
  .setNewTree(newCommitId)
  .call();

for (const entry of diffEntries) {
  console.log(`${entry.changeType}: ${entry.newPath || entry.oldPath}`);
}
```

**Key APIs:**
- `git.log()` - View commit history
- `git.diff()` - Compare commits or trees
- `.setMaxCount()` - Limit number of commits

**Diff Change Types:**
| Type | Description |
|------|-------------|
| `ADD` | New file added |
| `DELETE` | File deleted |
| `MODIFY` | File content changed |
| `RENAME` | File renamed |
| `COPY` | File copied |

---

### Step 6: Status

**File:** [src/steps/06-status.ts](src/steps/06-status.ts)

Check the repository status to see staged and unstaged changes.

```typescript
const status = await git.status().call();

console.log(`Clean: ${status.isClean()}`);
console.log(`Added files: ${status.added.size}`);
console.log(`Changed files: ${status.changed.size}`);
console.log(`Removed files: ${status.removed.size}`);
console.log(`Conflicting files: ${status.conflicting.size}`);

// List added files
for (const file of status.added) {
  console.log(`  + ${file}`);
}
```

**Key APIs:**
- `git.status()` - Get repository status
- `status.isClean()` - Check if working directory is clean
- `status.added` / `status.changed` / `status.removed` - File sets

---

### Step 7: Tags

**File:** [src/steps/07-tag.ts](src/steps/07-tag.ts)

Create lightweight and annotated tags.

```typescript
// Create lightweight tag
await git.tag().setName("v1.0.0").call();

// Create annotated tag
await git.tag()
  .setName("v2.0.0")
  .setAnnotated(true)
  .setMessage("Major version 2.0.0 release")
  .call();

// List tags
const tags = await git.tagList().call();
for (const tag of tags) {
  console.log(`- ${tag.name}`);
}

// Delete a tag
await git.tagDelete().setTags("v1.0.0-beta").call();
```

**Key APIs:**
- `git.tag()` - Create a tag
- `git.tagList()` - List all tags
- `git.tagDelete()` - Delete tags
- `.setAnnotated(true)` - Create annotated tag with metadata

---

### Step 8: Stash

**File:** [src/steps/08-stash.ts](src/steps/08-stash.ts)

Save work in progress and restore it later.

```typescript
// Create a stash
const stashCommit = await git.stashCreate()
  .setMessage("WIP: feature work")
  .call();

// List stashes
const stashes = await git.stashList().call();
for (const stash of stashes) {
  console.log(`stash@{${stash.index}}: ${stash.commitId.slice(0, 7)}`);
}

// Apply a stash (without removing)
await git.stashApply().setStashRef("stash@{0}").call();

// Pop a stash (apply and remove)
await git.stashPop().call();

// Drop a stash
await git.stashDrop().setStashRef("stash@{0}").call();
```

**Key APIs:**
- `git.stashCreate()` - Save work in progress
- `git.stashList()` - List all stashes
- `git.stashApply()` - Apply a stash (keep in list)
- `git.stashPop()` - Apply and remove stash
- `git.stashDrop()` - Remove a stash

---

## Key Concepts

### Commands API vs Low-Level API

The Commands API (porcelain) provides high-level operations that mirror git commands:

| Commands API | git command | Low-Level API |
|--------------|-------------|---------------|
| `git.commit()` | `git commit` | `commits.storeCommit()` |
| `git.branchCreate()` | `git branch` | `refs.set()` |
| `git.checkout()` | `git checkout` | `refs.setSymbolic()` |
| `git.merge()` | `git merge` | Manual tree merging |
| `git.log()` | `git log` | `commits.walkAncestry()` |

### GitStore

The `GitStore` combines repository storage with a staging area:

```typescript
import { createGitStore, Git } from "@statewalker/vcs-commands";

const store = createGitStore({ repository, staging });
const git = Git.wrap(store);
```

### Staging Files

Before committing, files must be staged:

```typescript
// Stage a file (helper function from shared.ts)
const editor = store.staging.editor();
editor.add({
  path: "file.txt",
  apply: () => ({
    path: "file.txt",
    mode: FileMode.REGULAR_FILE,
    objectId: blobId,
    stage: 0,
    size: content.length,
    mtime: Date.now(),
  }),
});
await editor.finish();
```

---

## Project Structure

```
apps/examples/02-porcelain-commands/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── main.ts                      # Main entry point (runs all steps)
    ├── shared.ts                    # Shared utilities
    └── steps/
        ├── 01-init-and-commit.ts    # Repository init and commits
        ├── 02-branching.ts          # Branch management
        ├── 03-checkout.ts           # Switch branches
        ├── 04-merge.ts              # Merge operations
        ├── 05-log-diff.ts           # History and diffs
        ├── 06-status.ts             # Repository status
        ├── 07-tag.ts                # Tag management
        └── 08-stash.ts              # Stash operations
```

---

## API Reference Links

### Commands Package (packages/commands)

| Class/Interface | Location | Purpose |
|-----------------|----------|---------|
| `Git` | [git.ts](../../../packages/commands/src/git.ts) | Main Git facade |
| `GitStore` | [git-store.ts](../../../packages/commands/src/git-store.ts) | Repository + staging |
| `CommitCommand` | [commands/commit.ts](../../../packages/commands/src/commands/) | Commit operations |
| `BranchCommand` | [commands/branch.ts](../../../packages/commands/src/commands/) | Branch operations |
| `MergeCommand` | [commands/merge.ts](../../../packages/commands/src/commands/) | Merge operations |
| `MergeStrategy` | [commands/merge.ts](../../../packages/commands/src/commands/) | Merge strategy enum |

### Core Package (packages/core)

| Interface | Location | Purpose |
|-----------|----------|---------|
| `HistoryStore` | [history/history-store.ts](../../../packages/core/src/history/history-store.ts) | Repository interface |
| `FileMode` | [history/trees/](../../../packages/core/src/history/trees/) | File type constants |

---

## Output Example

```
============================================================
  Porcelain Commands Example
============================================================

--- Step 1: Initialize and Commit ---

Creating Git facade with Git.wrap()...
Git facade created!

Staging files...
  Staged: README.md
  Staged: src/index.ts

Creating commit with git.commit()...
  Commit created: a1b2c3d
  Message: "Initial commit"

Adding more content...
  Second commit: e4f5g6h

Step 1 completed!

--- Step 2: Branching ---

Creating branch 'feature'...
  Branch 'feature' created

Listing branches with git.branchList()...
  Branches:
    - main
    - feature

Step 2 completed!
...
```

---

## Next Steps

- [03-object-model](../03-object-model/) - Deep dive into Git's object model
- [04-branching-merging](../04-branching-merging/) - Advanced branching and merging
