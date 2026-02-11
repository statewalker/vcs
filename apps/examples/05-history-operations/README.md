# 05-history-operations

Working with repository history using the statewalker-vcs Commands API. This example walks through log traversal, commit ancestry, diffing between commits, blame attribution, and file history tracking.

## Quick Start

```bash
# From the monorepo root
pnpm install
pnpm --filter @statewalker/vcs-example-05-history-operations start
```

## Running Individual Steps

Each step can be run independently:

```bash
pnpm --filter @statewalker/vcs-example-05-history-operations step:01  # Log traversal
pnpm --filter @statewalker/vcs-example-05-history-operations step:02  # Commit ancestry
pnpm --filter @statewalker/vcs-example-05-history-operations step:03  # Diff commits
pnpm --filter @statewalker/vcs-example-05-history-operations step:04  # Blame
pnpm --filter @statewalker/vcs-example-05-history-operations step:05  # File history
```

## What You'll Learn

- How to traverse commit history with `git.log()` and low-level `walkAncestry()`
- How to check ancestor relationships between commits and find merge bases
- How to compare commits and interpret change types (ADD, DELETE, MODIFY, RENAME)
- How to attribute individual lines to their originating commits with blame
- How to track the history of a specific file across commits

## Prerequisites

- Node.js 18+
- pnpm
- Completed [02-porcelain-commands](../02-porcelain-commands/)

---

## Step-by-Step Guide

### Step 1: Log Traversal

**File:** [src/steps/01-log-traversal.ts](src/steps/01-log-traversal.ts)

Walking through commit history using the porcelain log command and the low-level ancestry walker. The log command returns an async iterable of commit objects, ordered from newest to oldest.

```typescript
// Basic log - iterate all commits
for await (const commit of await git.log().call()) {
  console.log(commit.message);
}

// Limited log - only the most recent commits
for await (const commit of await git.log().setMaxCount(3).call()) {
  const commitId = await history.commits.store(commit);
  console.log(`${shortId(commitId)} ${commit.message}`);
}

// Low-level ancestry walk
const head = await history.refs.resolve("HEAD");
for await (const id of history.commits.walkAncestry(head.objectId, { limit: 3 })) {
  const commit = await history.commits.load(id);
  console.log(`${shortId(id)} ${commit.message}`);
}
```

**Key APIs:**
- `git.log().call()` - Returns async iterable of commit objects
- `git.log().setMaxCount(n)` - Limit results to the most recent N commits
- `git.log().setStartCommit(id)` - Start traversal from a specific commit
- `history.commits.walkAncestry(startId, { limit })` - Low-level commit walker

---

### Step 2: Commit Ancestry

**File:** [src/steps/02-commit-ancestry.ts](src/steps/02-commit-ancestry.ts)

Checking relationships between commits is essential for merges, fast-forward detection, and branch analysis. The merge base (common ancestor) determines how three-way merges work.

```typescript
// Find merge base (common ancestor of two branches)
const mergeBases = await history.commits.findMergeBase(commitC, commitD);
const commonAncestor = mergeBases[0];

// Manual ancestry check by walking the commit graph
async function isAncestor(ancestorId, descendantId) {
  const visited = new Set();
  const queue = [descendantId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === ancestorId) return true;
    visited.add(current);
    const commit = await history.commits.load(current);
    for (const parent of commit.parents) {
      if (!visited.has(parent)) queue.push(parent);
    }
  }
  return false;
}
```

**Key APIs:**
- `history.commits.findMergeBase(commitA, commitB)` - Find common ancestor(s)
- `history.commits.walkAncestry(startId)` - Walk commit parents in topological order
- `history.commits.load(commitId)` - Load a commit object by ID

---

### Step 3: Diff Between Commits

**File:** [src/steps/03-diff-commits.ts](src/steps/03-diff-commits.ts)

Comparing two commits produces a list of `DiffEntry` objects describing what changed between the snapshots. Each entry carries a change type, the affected paths, and the old/new blob IDs.

```typescript
// Diff between two commits
const diff = await git.diff()
  .setOldTree(commit1)
  .setNewTree(commit2)
  .call();

for (const entry of diff) {
  console.log(`${entry.changeType}: ${entry.newPath || entry.oldPath}`);
}

// Change types: ADD, DELETE, MODIFY, RENAME, COPY
```

**Key APIs:**
- `git.diff().setOldTree(commitId).setNewTree(commitId).call()` - Compare two commits
- `DiffEntry.changeType` - One of ADD, DELETE, MODIFY, RENAME, or COPY
- `DiffEntry.oldPath` / `DiffEntry.newPath` - File paths in old and new trees
- `formatDiffEntry(entry)` - Format a diff entry for display

---

### Step 4: Blame

**File:** [src/steps/04-blame.ts](src/steps/04-blame.ts)

Blame traces each line in a file back to the commit that introduced it. The result includes the author, commit message, and original line number for every line in the file.

```typescript
// Blame a file
const result = await git.blame()
  .setFilePath("src/config.ts")
  .call();

// Get author of a specific line
const author = result.getSourceAuthor(5);
console.log(`Line 5 by: ${author?.name}`);

// Iterate blame entries (grouped by commit)
for (const entry of result.entries) {
  console.log(`Lines ${entry.resultStart}-${entry.resultStart + entry.lineCount - 1}`);
  console.log(`  By: ${entry.commit.author.name}`);
  console.log(`  Message: ${entry.commit.message}`);
}
```

**Key APIs:**
- `git.blame().setFilePath(path).call()` - Run blame on a file (path is required)
- `BlameResult.entries` - Array of `BlameEntry` grouped by originating commit
- `BlameResult.getSourceAuthor(line)` - Get author of a specific line (1-based)
- `BlameResult.getSourceCommit(line)` - Get commit that introduced a line
- `BlameResult.getLineTracking()` - Detailed per-line tracking information

---

### Step 5: File History

**File:** [src/steps/05-file-history.ts](src/steps/05-file-history.ts)

Tracking changes to a specific file by walking the commit graph and comparing blob IDs. Commits where the file's blob ID changes are the ones that modified it.

```typescript
const fileHistory = [];
let previousBlobId;

for await (const commitId of history.commits.walkAncestry(headId)) {
  const commit = await history.commits.load(commitId);
  const blobId = await getFileBlobId(history, commit.tree, "src/main.ts");

  if (blobId && blobId !== previousBlobId) {
    fileHistory.push({ commitId, commit, blobId });
    previousBlobId = blobId;
  }
}

console.log(`Found ${fileHistory.length} commits affecting src/main.ts`);
```

**Key APIs:**
- `history.commits.walkAncestry(startId)` - Walk all ancestor commits
- `history.trees.getEntry(treeId, name)` - Look up a file entry in a tree
- `history.blobs.load(blobId)` - Load file content by blob ID

---

## Key Concepts

### Log Traversal

The `git.log()` command walks backward through the commit graph starting from HEAD (or a specified commit). Each commit points to its parent(s), forming a directed acyclic graph. The `setMaxCount()` option limits how many commits to return, which is useful for pagination or displaying recent activity. For more control, `history.commits.walkAncestry()` gives direct access to the low-level walker with a `limit` option.

### Ancestry and Merge Bases

Two commits share a common ancestor when their parent chains eventually converge. The `findMergeBase()` method finds this convergence point, which is the input to three-way merge. Fast-forward detection relies on ancestry: if the current HEAD is an ancestor of the merge source, the branch pointer can move forward without creating a merge commit.

### Diff Change Types

When comparing two tree snapshots, each file can appear as one of five change types. ADD means the file exists only in the new tree. DELETE means it exists only in the old tree. MODIFY means the path is the same but the content (blob ID) differs. RENAME and COPY are detected by content similarity when a file disappears from one path and appears at another.

### Blame Attribution

Blame works backward from the current version of a file, assigning each line to the commit that last modified it. The result groups consecutive lines that share the same originating commit into `BlameEntry` objects. You can query individual lines by number (1-based) to get the author, commit, or original line number in the source commit.

---

## Project Structure

```
apps/examples/05-history-operations/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── main.ts                       # Main entry point (runs all steps)
    ├── shared.ts                     # Shared utilities and Git setup
    └── steps/
        ├── 01-log-traversal.ts       # Log traversal demonstration
        ├── 02-commit-ancestry.ts     # Commit ancestry demonstration
        ├── 03-diff-commits.ts        # Diff between commits demonstration
        ├── 04-blame.ts               # Blame demonstration
        └── 05-file-history.ts        # File history demonstration
```

---

## Output Example

```
============================================================
  Step 1: Log Traversal
============================================================

--- Step 1: Log Traversal ---

--- Setting up commit history ---
  Created: Initial commit
  Created: Add src/index.ts
  Created: Add src/utils.ts
  Created: Add documentation
  Created: Update version to 2

--- Basic log traversal ---

Using git.log().call():
  a3f21bc Update version to 2
  e8d0c14 Add documentation
  9b7a3e5 Add src/utils.ts
  5c1d8f2 Add src/index.ts
  1a0b3c4 Initial commit

  Total commits: 5

--- Limited log (maxCount) ---

Using git.log().setMaxCount(3).call():
  a3f21bc Update version to 2
  e8d0c14 Add documentation
  9b7a3e5 Add src/utils.ts

--- Detailed commit information ---

Showing full commit details:

  Commit 1:
    ID:        a3f21bc4e8d0c149b7a3e55c1d8f21a0b3c4...
    Message:   Update version to 2
    Author:    Author <author@example.com>
    Date:      2025-01-15
    Tree:      b2c3d4e
    Parents:   e8d0c14

--- Low-level: Walking ancestry ---

Using history.commits.walkAncestry():
  a3f21bc Update version to 2
  e8d0c14 Add documentation
  9b7a3e5 Add src/utils.ts

Step 1 completed!

============================================================
  Step 4: Blame
============================================================

--- Step 4: Blame ---
--- Running git blame ---

  File: src/config.ts
  Lines: 8
  Entries: 3

--- Blame output ---

  Line | Commit  | Author        | Content
  ------------------------------------------------------------
     1 | 1a0b3c4 | Author       | // Configuration file
     2 | 7d8e9f0 | Author       | // Updated for v2
     3 | 1a0b3c4 | Author       | export const config = {
     4 | 1a0b3c4 | Author       |   name: "MyApp",
     5 | 7d8e9f0 | Author       |   version: "2.0.0",
     6 | 4b5c6d7 | Author       |   debug: false,
     7 | 7d8e9f0 | Author       |   features: ["auth", "api"],
     8 | 1a0b3c4 | Author       | };

Step 4 completed!
...
```

---

## API Reference Links

### Commands Package (packages/commands)

| Interface | Location | Purpose |
|-----------|----------|---------|
| `Git` | [src/git.ts](../../../packages/commands/src/git.ts) | Main porcelain facade |
| `LogCommand` | [src/commands/log-command.ts](../../../packages/commands/src/commands/log-command.ts) | Log traversal command |
| `DiffCommand` | [src/commands/diff-command.ts](../../../packages/commands/src/commands/diff-command.ts) | Diff between commits |
| `BlameCommand` | [src/commands/blame-command.ts](../../../packages/commands/src/commands/blame-command.ts) | Line-by-line blame |
| `DiffEntry` | [src/results/diff-entry.ts](../../../packages/commands/src/results/diff-entry.ts) | Diff result structure |

### Core Package (packages/core)

| Interface | Location | Purpose |
|-----------|----------|---------|
| `CommitStore` | [src/history/commits/](../../../packages/core/src/history/commits/) | Commit storage and ancestry |
| `TreeStore` | [src/history/trees/](../../../packages/core/src/history/trees/) | Tree entry lookups |
| `BlobStore` | [src/history/blobs/](../../../packages/core/src/history/blobs/) | Blob content storage |
| `RefStore` | [src/history/refs/](../../../packages/core/src/history/refs/) | Reference resolution |

---

## Next Steps

- [04-branching-merging](../04-branching-merging/) - Branch operations and merge strategies
- [07-staging-checkout](../07-staging-checkout/) - Working tree and staging area operations
