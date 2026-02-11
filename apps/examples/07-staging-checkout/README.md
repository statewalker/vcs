# 07-staging-checkout

Working directory and staging area operations using the statewalker-vcs Commands API. This example walks through the full lifecycle of staging, unstaging, status checking, file and branch checkout, and reset.

## Quick Start

```bash
# From the monorepo root
pnpm install
pnpm --filter @statewalker/vcs-example-07-staging-checkout start
```

## Running Individual Steps

Each step can be run independently:

```bash
pnpm --filter @statewalker/vcs-example-07-staging-checkout step:01  # Staging concepts
pnpm --filter @statewalker/vcs-example-07-staging-checkout step:02  # Staging changes
pnpm --filter @statewalker/vcs-example-07-staging-checkout step:03  # Unstaging
pnpm --filter @statewalker/vcs-example-07-staging-checkout step:04  # Status
pnpm --filter @statewalker/vcs-example-07-staging-checkout step:05  # Checkout files
pnpm --filter @statewalker/vcs-example-07-staging-checkout step:06  # Checkout branches
pnpm --filter @statewalker/vcs-example-07-staging-checkout step:07  # Clean and reset
```

## What You'll Learn

- How the staging area (index) sits between the working tree and the repository
- Adding files to staging with the porcelain API and the low-level editor/builder
- Removing entries from staging and resetting to match HEAD
- Querying repository status for added, changed, removed, and conflicting files
- Restoring individual files from earlier commits
- Switching branches by updating HEAD and reading the target tree
- Reset modes (soft, mixed, hard) and the clean command

## Prerequisites

- Node.js 18+
- pnpm
- Completed [02-porcelain-commands](../02-porcelain-commands/)

---

## Step-by-Step Guide

### Step 1: Staging Concepts

**File:** [src/steps/01-staging-concepts.ts](src/steps/01-staging-concepts.ts)

The staging area (also called the "index") holds the contents of your next commit. It sits between the working tree and the repository, giving you fine-grained control over which changes are included in each commit.

```typescript
await resetState();
const { git, workingCopy } = await getGit();

// Create initial commit
await addFileToStaging(workingCopy, "README.md", "# Staging Demo");
await git.commit().setMessage("Initial commit").call();

// Iterate staging entries after commit
for await (const entry of workingCopy.checkout.staging.entries()) {
  console.log(`${entry.path} -> ${shortId(entry.objectId)}`);
}
```

**Key APIs:**
- `staging.entries()` - Iterate all entries in the staging area
- `staging.createEditor()` - Create an editor for adding/removing entries
- `staging.createBuilder()` - Build a staging area from scratch

---

### Step 2: Staging Changes

**File:** [src/steps/02-staging-changes.ts](src/steps/02-staging-changes.ts)

There are multiple ways to add files to staging. The porcelain API mirrors `git add`, while the low-level editor and builder give you direct control over entry metadata.

```typescript
// Low-level: store blob then add to staging via editor
const content = new TextEncoder().encode("export const v1 = 1;");
const blobId = await workingCopy.history.blobs.store([content]);

const editor = workingCopy.checkout.staging.createEditor();
editor.add({
  path: "src/version.ts",
  apply: () => ({
    path: "src/version.ts",
    mode: FileMode.REGULAR_FILE,
    objectId: blobId,
    stage: MergeStage.MERGED,
    size: content.length,
    mtime: Date.now(),
  }),
});
await editor.finish();
```

**Key APIs:**
- `git.add().addFilepattern(pattern).call()` - Porcelain staging (single file, directory, or `.` for all)
- `staging.createEditor()` - Add or update individual entries
- `staging.createBuilder()` - Rebuild the entire staging area

---

### Step 3: Unstaging

**File:** [src/steps/03-unstaging.ts](src/steps/03-unstaging.ts)

Unstaging removes files from the next commit. You can remove a single entry with the editor, rebuild staging without certain files using the builder, or reset the entire staging area to match a tree from HEAD.

```typescript
// Remove a single entry
const editor = workingCopy.checkout.staging.createEditor();
editor.remove("src/remove.ts");
await editor.finish();

// Reset staging to match HEAD
const head = await history.refs.resolve("HEAD");
const commit = await history.commits.load(head.objectId);
await workingCopy.checkout.staging.readTree(history.trees, commit.tree);
```

**Key APIs:**
- `git.reset().addPath(path).call()` - Unstage a specific file (porcelain)
- `editor.remove(path)` - Remove a single staging entry
- `staging.readTree(trees, treeId)` - Reset staging to match a tree

---

### Step 4: Status

**File:** [src/steps/04-status.ts](src/steps/04-status.ts)

The status command compares staging against HEAD to find what changed. It returns sets of added, changed, removed, and conflicting file paths.

```typescript
const status = await git.status().call();

console.log("Added:", [...status.added]);
console.log("Changed:", [...status.changed]);
console.log("Removed:", [...status.removed]);
console.log("Conflicting:", [...status.conflicting]);

if (status.isClean()) {
  console.log("Working tree is clean");
}
```

**Key APIs:**
- `git.status().call()` - Returns a `StatusResult` with `added`, `changed`, `removed`, `untracked`, and `conflicting` sets
- `status.isClean()` - Returns `true` when there are no changes

---

### Step 5: Checkout Files

**File:** [src/steps/05-checkout-files.ts](src/steps/05-checkout-files.ts)

File checkout restores individual files from a specific commit without moving HEAD. This updates the staging area (and working tree in a real repository) with the older version.

```typescript
// Read blob from an earlier commit's tree
const commit = await history.commits.load(commitId);
const blobId = await history.trees.getEntry(commit.tree, "config.json");

// Update staging with the older version
const editor = workingCopy.checkout.staging.createEditor();
editor.add({
  path: "config.json",
  apply: (existing) => ({
    path: "config.json",
    mode: existing?.mode ?? 0o100644,
    objectId: blobId.id,
    stage: MergeStage.MERGED,
    size: existing?.size ?? 0,
    mtime: Date.now(),
  }),
});
await editor.finish();
```

**Key APIs:**
- `git.checkout().setStartPoint(commitId).addPath("file").call()` - Porcelain file checkout
- `history.trees.getEntry(treeId, path)` - Look up a file entry in a tree
- `history.blobs.load(blobId)` - Load blob content

---

### Step 6: Checkout Branches

**File:** [src/steps/06-checkout-branches.ts](src/steps/06-checkout-branches.ts)

Branch checkout moves HEAD to point at a different branch and updates the staging area to match that branch's commit tree. You can also create a new branch during checkout.

```typescript
// Porcelain: switch to existing branch
await git.checkout().setName("feature").call();

// Porcelain: create and switch
await git.checkout().setName("new-feature").setCreateBranch(true).call();

// Low-level: update HEAD and staging manually
await history.refs.setSymbolic("HEAD", "refs/heads/feature");
const ref = await history.refs.resolve("refs/heads/feature");
const commit = await history.commits.load(ref.objectId);
await workingCopy.checkout.staging.readTree(history.trees, commit.tree);
```

**Key APIs:**
- `git.checkout().setName(branch).call()` - Switch to existing branch
- `git.checkout().setName(branch).setCreateBranch(true).call()` - Create and switch
- `history.refs.setSymbolic("HEAD", target)` - Low-level HEAD update
- `staging.readTree(trees, treeId)` - Refresh staging from a tree

---

### Step 7: Clean and Reset

**File:** [src/steps/07-clean-reset.ts](src/steps/07-clean-reset.ts)

Reset moves HEAD (and optionally updates staging and working tree) to a target commit. The three modes control how much state gets rolled back. The clean command removes untracked files.

```typescript
// Soft reset: undo commit, keep staged changes
await git.reset().setRef("HEAD~1").setMode("soft").call();

// Mixed reset (default): undo commit, unstage changes
await git.reset().setRef(commitId).call();

// Hard reset: discard everything
await git.reset().setRef(commitId).setMode("hard").call();

// Reset a specific file
await git.reset().addPath("path/to/file").call();
```

**Key APIs:**
- `git.reset().setRef(ref).setMode(mode).call()` - Reset with soft, mixed, or hard mode
- `git.reset().addPath(path).call()` - Reset (unstage) a specific file
- `git.clean().setForce(true).call()` - Remove untracked files

---

## Key Concepts

### Staging Entry Structure

Each entry in the staging area tracks a file that will be part of the next commit. The entry carries the file path, its mode (regular file, executable, symlink), the SHA-1 of the blob content, and a merge stage value that indicates whether the file is cleanly merged or in conflict.

```typescript
interface StagingEntry {
  path: string;      // File path relative to repository root
  mode: number;      // File mode (100644, 100755, etc.)
  objectId: string;  // Blob SHA-1
  stage: number;     // Merge stage (0=normal, 1=base, 2=ours, 3=theirs)
  size: number;      // File size in bytes
  mtime: number;     // Modification time
}
```

### Merge Stages

During a merge conflict, the staging area holds multiple versions of the same file at different stages. Stage 0 is the normal (resolved) state. Stages 1 through 3 appear during a conflict and represent the common ancestor (BASE), the current branch (OURS), and the incoming branch (THEIRS) respectively. Resolving a conflict means collapsing these three stages back into a single stage-0 entry.

| Stage | Name | Description |
|-------|------|-------------|
| 0 | Normal | No conflict |
| 1 | BASE | Common ancestor |
| 2 | OURS | Current branch |
| 3 | THEIRS | Incoming branch |

### Reset Modes

The three reset modes give you different levels of rollback. Soft reset only moves the branch pointer, so your staged changes remain intact -- useful for amending or squashing commits. Mixed reset (the default) also clears the staging area, leaving changes in the working tree. Hard reset discards everything, restoring both staging and working tree to match the target commit.

| Mode | HEAD | Staging | Working Tree |
|------|------|---------|--------------|
| soft | Moves | Unchanged | Unchanged |
| mixed | Moves | Reset | Unchanged |
| hard | Moves | Reset | Reset |

### Common Operations

| Operation | High-level | Low-level |
|-----------|------------|-----------|
| Stage file | `git.add().addFilepattern()` | `staging.createEditor().add()` |
| Unstage file | `git.reset().addPath()` | `staging.createEditor().remove()` |
| Check status | `git.status().call()` | Compare staging vs HEAD tree |
| Checkout file | `git.checkout().addPath()` | Read blob, update staging |
| Switch branch | `git.checkout().setName()` | Update HEAD, readTree |
| Reset | `git.reset().setMode()` | Move refs, update staging |

---

## Project Structure

```
apps/examples/07-staging-checkout/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── main.ts                        # Main entry point (runs all steps)
    ├── shared.ts                      # Shared utilities and helpers
    └── steps/
        ├── 01-staging-concepts.ts     # Staging area fundamentals
        ├── 02-staging-changes.ts      # Adding files to staging
        ├── 03-unstaging.ts            # Removing files from staging
        ├── 04-status.ts               # Checking repository status
        ├── 05-checkout-files.ts       # Restoring files from commits
        ├── 06-checkout-branches.ts    # Switching branches
        └── 07-clean-reset.ts          # Reset modes and cleaning
```

---

## Output Example

```
╔══════════════════════════════════════════════════════════════════════════════╗
║               statewalker-vcs: Staging and Checkout Example                ║
╚══════════════════════════════════════════════════════════════════════════════╝

============================================================
  Step 1: Staging Concepts
============================================================

--- What is the Staging Area? ---

  The staging area (also called "index") is a key Git concept:

  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
  │  Working Tree   │────>│  Staging Area   │────>│   Repository    │
  │                 │ add │    (Index)      │ commit  (Commits)    │
  └─────────────────┘     └─────────────────┘     └─────────────────┘

--- Setting up repository ---
  Created initial commit

--- Current staging area ---

  Entry 1:
    Path:     README.md
    Mode:     100644 (file)
    ObjectId: 7b541fb8e12f8a65c0d8b9b0e0f0a1b2c3d4e5f6
    Stage:    0

--- Adding files to staging ---
  Added: src/index.ts
  Added: src/utils.ts

  Staging area now contains:
    README.md -> 7b541fb
    src/index.ts -> a3c9e12
    src/utils.ts -> f4d8b07

Step 1 completed!

============================================================
  Step 2: Staging Changes
============================================================

--- Methods to stage files ---

2. Using staging editor (low-level API):
  Stored blob: e4f5a6b
  Added to staging: src/version.ts

--- Updating a staged file ---
  New blob: c7d8e9f
  Updated: src/version.ts

Step 2 completed!
...
```

---

## API Reference Links

### Core Package (packages/core)

| Interface/Class | Location | Purpose |
|-----------------|----------|---------|
| `Staging` | [workspace/staging/staging.ts](../../../packages/core/src/workspace/staging/staging.ts) | Staging area interface |
| `StagingEdits` | [workspace/staging/staging-edits.ts](../../../packages/core/src/workspace/staging/staging-edits.ts) | Staging editor and builder |
| `Checkout` | [workspace/checkout/checkout.ts](../../../packages/core/src/workspace/checkout/checkout.ts) | HEAD, staging, and operation state |
| `RefStore` | [history/refs/ref-store.ts](../../../packages/core/src/history/refs/ref-store.ts) | Reference storage and resolution |
| `WorkingCopy` | [workspace/working-copy.ts](../../../packages/core/src/workspace/working-copy.ts) | Composes history, checkout, and worktree |

### Commands Package (packages/commands)

| Command | Location | Purpose |
|---------|----------|---------|
| `AddCommand` | [commands/add-command.ts](../../../packages/commands/src/commands/add-command.ts) | Stage files |
| `StatusCommand` | [commands/status-command.ts](../../../packages/commands/src/commands/status-command.ts) | Check repository state |
| `CheckoutCommand` | [commands/checkout-command.ts](../../../packages/commands/src/commands/checkout-command.ts) | Checkout files and branches |
| `ResetCommand` | [commands/reset-command.ts](../../../packages/commands/src/commands/reset-command.ts) | Reset HEAD, staging, and working tree |
| `CleanCommand` | [commands/clean-command.ts](../../../packages/commands/src/commands/clean-command.ts) | Remove untracked files |

---

## Next Steps

- [04-branching-merging](../04-branching-merging/) - Branch operations and merge strategies
- [06-internal-storage](../06-internal-storage/) - Low-level object and pack operations
