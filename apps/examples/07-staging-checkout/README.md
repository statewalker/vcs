# Staging and Checkout Example

Working directory and staging area operations using the statewalker-vcs Commands API.

## Quick Start

```bash
# Run all steps
pnpm start

# Run individual steps
pnpm step:01  # Staging concepts
pnpm step:02  # Staging changes
pnpm step:03  # Unstaging
pnpm step:04  # Status
pnpm step:05  # Checkout files
pnpm step:06  # Checkout branches
pnpm step:07  # Clean and reset
```

## What You'll Learn

### Step 1: Staging Concepts

Understanding the index/staging area.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Working Tree   │────▶│  Staging Area   │────▶│   Repository    │
│                 │ add │    (Index)      │ commit  (Commits)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Step 2: Staging Changes

Adding files to the staging area.

```typescript
// High-level: git.add()
await git.add().addFilepattern("src/").call();

// Low-level: staging editor
const data = new TextEncoder().encode(content);
const blobId = await store.blobs.store([data]);

const editor = store.staging.editor();
editor.add({
  path: "file.ts",
  apply: () => ({
    path: "file.ts",
    mode: FileMode.REGULAR_FILE,
    objectId: blobId,
    stage: 0,
    size: data.length,
    mtime: Date.now(),
  }),
});
await editor.finish();
```

### Step 3: Unstaging

Removing files from staging.

```typescript
// High-level
await git.reset().addPath("file.ts").call();

// Low-level: editor
const editor = store.staging.editor();
editor.remove("file.ts");
await editor.finish();

// Reset staging to HEAD
const head = await store.refs.resolve("HEAD");
const commit = await store.commits.loadCommit(head.objectId);
await store.staging.readTree(store.trees, commit.tree);
```

### Step 4: Status

Checking repository state.

```typescript
const status = await git.status().call();

// File collections
console.log("Added:", [...status.added]);
console.log("Changed:", [...status.changed]);
console.log("Removed:", [...status.removed]);
console.log("Conflicting:", [...status.conflicting]);

// Helper
if (status.isClean()) {
  console.log("Working tree is clean");
}
```

### Step 5: Checkout Files

Restoring files from commits.

```typescript
// Checkout file from specific commit
await git.checkout()
  .setStartPoint(commitId)
  .addPath("config.json")
  .call();

// Low-level: read from commit tree
const commit = await store.commits.loadCommit(commitId);
const entry = await store.trees.getEntry(commit.tree, "config.json");
// Then update staging with entry.id
```

### Step 6: Checkout Branches

Switching branches.

```typescript
// Switch to branch
await git.checkout().setName("feature").call();

// Create and switch
await git.checkout()
  .setName("new-feature")
  .setCreateBranch(true)
  .call();

// Low-level
await store.refs.setSymbolic("HEAD", "refs/heads/feature");
const ref = await store.refs.resolve("refs/heads/feature");
const commit = await store.commits.loadCommit(ref.objectId);
await store.staging.readTree(store.trees, commit.tree);
```

### Step 7: Clean and Reset

Reset modes and cleaning.

| Mode | HEAD | Staging | Working Tree |
|------|------|---------|--------------|
| soft | Moves | Unchanged | Unchanged |
| mixed | Moves | Reset | Unchanged |
| hard | Moves | Reset | Reset |

```typescript
// Soft reset: undo commit, keep staged
await git.reset().setRef("HEAD~1").setMode("soft").call();

// Mixed reset: undo commit, unstage
await git.reset().setRef("HEAD~1").call();

// Hard reset: discard all changes
await git.reset().setRef("HEAD~1").setMode("hard").call();
```

## Staging Entry Structure

```typescript
interface StagingEntry {
  path: string;      // File path
  mode: number;      // File mode (100644, 100755, etc.)
  objectId: string;  // Blob SHA-1
  stage: number;     // Merge stage (0=normal, 1=base, 2=ours, 3=theirs)
  size: number;      // File size
  mtime: number;     // Modification time
}
```

## Merge Stages

| Stage | Name | Description |
|-------|------|-------------|
| 0 | Normal | No conflict |
| 1 | BASE | Common ancestor |
| 2 | OURS | Current branch |
| 3 | THEIRS | Incoming branch |

## Common Operations

| Operation | High-level | Low-level |
|-----------|------------|-----------|
| Stage file | `git.add().addFilepattern()` | `staging.editor().add()` |
| Unstage file | `git.reset().addPath()` | `staging.editor().remove()` |
| Check status | `git.status().call()` | Compare staging vs HEAD |
| Checkout file | `git.checkout().addPath()` | Read blob, update staging |
| Switch branch | `git.checkout().setName()` | Update HEAD, read tree |
| Reset | `git.reset().setMode()` | Move refs, update staging |

## Related Examples

- [02-porcelain-commands](../02-porcelain-commands/) - Full Commands API
- [04-branching-merging](../04-branching-merging/) - Branch operations
- [05-history-operations](../05-history-operations/) - Log, diff, blame
