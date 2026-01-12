# History Operations Example

Working with repository history using the statewalker-vcs Commands API: log, diff, blame, and ancestry operations.

## Quick Start

```bash
# Run all steps
pnpm start

# Run individual steps
pnpm step:01  # Log traversal
pnpm step:02  # Commit ancestry
pnpm step:03  # Diff commits
pnpm step:04  # Blame
pnpm step:05  # File history
```

## What You'll Learn

### Step 1: Log Traversal

Walking through commit history.

```typescript
// Basic log - iterate all commits
for await (const commit of await git.log().call()) {
  console.log(commit.message);
}

// Limited log
for await (const commit of await git.log().setMaxCount(10).call()) {
  console.log(commit.message);
}

// Low-level ancestry walk
for await (const id of store.commits.walkAncestry(headId, { limit: 10 })) {
  const commit = await store.commits.loadCommit(id);
  console.log(commit.message);
}
```

### Step 2: Commit Ancestry

Checking relationships between commits.

```typescript
// Find merge base (common ancestor)
const mergeBases = await store.commits.findMergeBase(commitA, commitB);
const commonAncestor = mergeBases[0];

// Manual ancestry check
async function isAncestor(ancestorId, descendantId) {
  for await (const id of store.commits.walkAncestry(descendantId)) {
    if (id === ancestorId) return true;
  }
  return false;
}
```

### Step 3: Diff Between Commits

Comparing commits to see changes.

```typescript
// Diff between two commits
const diff = await git.diff()
  .setOldTree(commit1)
  .setNewTree(commit2)
  .call();

for (const entry of diff) {
  console.log(`${entry.changeType}: ${entry.newPath || entry.oldPath}`);
}

// Change types
// ADD    - New file
// DELETE - Removed file
// MODIFY - Content changed
// RENAME - File moved/renamed
// COPY   - File copied
```

### Step 4: Blame

Line-by-line attribution.

```typescript
// Blame a file
const result = await git.blame()
  .setFilePath("src/main.ts")
  .call();

// Get author of specific line
const author = result.getSourceAuthor(42);
console.log(`Line 42 by: ${author?.name}`);

// Iterate blame entries
for (const entry of result.entries) {
  console.log(`Lines ${entry.resultStart}-${entry.resultStart + entry.lineCount - 1}`);
  console.log(`  By: ${entry.commit.author.name}`);
  console.log(`  Message: ${entry.commit.message}`);
}

// With rename tracking
const resultWithRenames = await git.blame()
  .setFilePath("src/new-name.ts")
  .setFollowRenames(true)
  .call();
```

### Step 5: File History

Tracking changes to specific files.

```typescript
// Manual file history tracking
const fileHistory = [];
let previousBlobId;

for await (const commitId of store.commits.walkAncestry(headId)) {
  const commit = await store.commits.loadCommit(commitId);
  const blobId = await getFileBlobId(store, commit.tree, "src/main.ts");

  if (blobId && blobId !== previousBlobId) {
    fileHistory.push({ commitId, commit, blobId });
    previousBlobId = blobId;
  }
}
```

## API Reference

### Log Command

```typescript
git.log()
  .setMaxCount(n)           // Limit results
  .setStartCommit(id)       // Start from commit
  .call()                   // Returns AsyncIterable<Commit>
```

### Diff Command

```typescript
git.diff()
  .setOldTree(commitId)     // From commit
  .setNewTree(commitId)     // To commit
  .call()                   // Returns DiffEntry[]
```

### Blame Command

```typescript
git.blame()
  .setFilePath(path)        // File to blame (required)
  .setStartCommit(id)       // Start from commit
  .setFollowRenames(bool)   // Follow renames
  .call()                   // Returns BlameResult
```

### BlameResult Methods

| Method | Description |
|--------|-------------|
| `entries` | Array of BlameEntry |
| `getEntry(line)` | Get entry for line (1-based) |
| `getSourceCommit(line)` | Commit that introduced line |
| `getSourceAuthor(line)` | Author of line |
| `getSourceLine(line)` | Original line number |
| `getLineTracking()` | Detailed tracking for all lines |

## Common Use Cases

| Use Case | API |
|----------|-----|
| View recent commits | `git.log().setMaxCount(10)` |
| Find who changed a line | `git.blame().setFilePath(path)` |
| Compare two versions | `git.diff().setOldTree().setNewTree()` |
| Find common ancestor | `store.commits.findMergeBase()` |
| Track file changes | Walk commits + check file blob |

## Related Examples

- [02-porcelain-commands](../02-porcelain-commands/) - Full Commands API
- [04-branching-merging](../04-branching-merging/) - Branch operations
- [07-staging-checkout](../07-staging-checkout/) - Working tree operations
