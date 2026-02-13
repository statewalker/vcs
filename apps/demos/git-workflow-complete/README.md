# Complete Git Workflow Demo

Comprehensive demonstration of Git operations using WebRun VCS, showcasing the full lifecycle from repository creation through branching, merging, and garbage collection.

## Quick Start

```bash
pnpm start
```

## What This Demo Shows

```
Step 01: Initialize repository with FilesApi
Step 02: Create project structure with multiple files
Step 03: Generate commits with incremental changes
Step 04: Create and manage branches (feature, bugfix)
Step 05: Perform merge operations (fast-forward, three-way)
Step 06: View diffs between commits
Step 07: Run garbage collection and create pack files
Step 08: Checkout first version using native git
Step 09: Verify checkout matches original content
```

## Running Individual Steps

```bash
pnpm step:01  # Initialize Repository
pnpm step:02  # Create Initial Files
pnpm step:03  # Generate Commits
pnpm step:04  # Branch Operations
pnpm step:05  # Merge Operations
pnpm step:06  # Diff Viewer
pnpm step:07  # Garbage Collection & Packing
pnpm step:08  # Checkout First Version
pnpm step:09  # Verify Checkout
```

## Key Concepts Demonstrated

### Branching and Merging

```typescript
import { Git, MergeStrategy } from "@statewalker/vcs-commands";

// Create branches
await git.branchCreate().setName("feature").call();
await git.branchCreate().setName("bugfix").call();

// Merge with strategy
const result = await git
  .merge()
  .include("feature")
  .setStrategy(MergeStrategy.RECURSIVE)
  .call();
```

### Viewing Diffs

```typescript
// Compare two commits
const diff = await git
  .diff()
  .setOldTree(previousCommitId)
  .setNewTree(latestCommitId)
  .call();

for (const entry of diff) {
  console.log(`${entry.changeType}: ${entry.newPath}`);
}
```

### Garbage Collection

```typescript
import { PackWriterStream, writePackIndexV2 } from "@statewalker/vcs-core";

// Pack loose objects
const packWriter = new PackWriterStream();
await packWriter.addObject(objectId, type, content);
const result = await packWriter.finalize();

// Write pack and index files
await fs.writeFile("pack.pack", result.packData);
const indexData = await writePackIndexV2(result.indexEntries, result.packChecksum);
await fs.writeFile("pack.idx", indexData);
```

## Requirements

- Node.js 18+
- Git (for checkout and verification steps)

## Output

The demo creates a `test-workflow-repo/` directory with a fully functional Git repository that can be inspected with native git tools.
