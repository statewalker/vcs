# 01-quick-start

Get running with statewalker-vcs in 5 minutes! This example demonstrates the fundamental Git workflow using the low-level API: creating a repository, storing content, building directory snapshots, making commits, and viewing history.

## Quick Start

```bash
# From the monorepo root
pnpm install
pnpm --filter @statewalker/vcs-examples-01-quick-start start
```

## What You'll Learn

- Initialize an in-memory Git repository
- Store file content as blobs (content-addressable storage)
- Create directory snapshots (trees)
- Make commits with author/committer info
- Update branch references
- Walk commit history

## Prerequisites

- Node.js 18+
- pnpm

---

## The Complete Workflow

**File:** [src/main.ts](src/main.ts)

### Step 1: Initialize Repository

Create an in-memory Git repository with the standard directory structure.

```typescript
import { createGitRepository, createInMemoryFilesApi, FileMode } from "@statewalker/vcs-core";

// Create file system (in-memory for this example)
const files = createInMemoryFilesApi();

// Initialize repository
const repository = await createGitRepository(files, ".git", {
  create: true,
  defaultBranch: "main",
});
```

**Key APIs:**
- [`createGitRepository()`](../../../packages/core/src/stores/create-repository.ts) - Factory function for creating/opening repos
- [`createInMemoryFilesApi()`](../../../packages/core/src/stores/filesystem/memory/index.ts) - In-memory file system

---

### Step 2: Store File Content (Blob)

Store file content as a Git blob object. Blobs are content-addressable: identical content always produces the same hash.

```typescript
const encoder = new TextEncoder();
const content = encoder.encode("# My Project\n\nWelcome to my first VCS project!");
const blobId = await repository.blobs.store([content]);
console.log(`Blob stored: ${blobId.slice(0, 7)}`);
```

**Key APIs:**
- `BlobStore.store()` - Store content chunks, returns ObjectId
- `BlobStore.load()` - Load content as async iterable
- `BlobStore.getSize()` - Get object size

**Key Concepts:**
- Content is hashed (SHA-1) to produce the ObjectId
- Identical content automatically deduplicates
- Storage uses streaming for memory efficiency

---

### Step 3: Create Directory Snapshot (Tree)

Create a Git tree object representing a directory. Trees contain entries with mode, name, and object ID.

```typescript
const treeId = await repository.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId },
]);
console.log(`Tree stored: ${treeId.slice(0, 7)}`);
```

**Key APIs:**
- `TreeStore.storeTree()` - Create tree from entries
- `TreeStore.loadTree()` - Load entries as stream
- `TreeStore.getEntry()` - Get single entry by name

**File Modes:**
| Mode | Constant | Description |
|------|----------|-------------|
| `040000` | `FileMode.TREE` | Directory |
| `100644` | `FileMode.REGULAR_FILE` | Regular file |
| `100755` | `FileMode.EXECUTABLE_FILE` | Executable file |
| `120000` | `FileMode.SYMLINK` | Symbolic link |
| `160000` | `FileMode.GITLINK` | Submodule |

---

### Step 4: Create Commit

Create a Git commit object that links a tree snapshot to history.

```typescript
const now = Date.now() / 1000;
const commitId = await repository.commits.storeCommit({
  tree: treeId,
  parents: [],  // Empty for initial commit
  author: {
    name: "Developer",
    email: "dev@example.com",
    timestamp: now,
    tzOffset: "+0000",
  },
  committer: {
    name: "Developer",
    email: "dev@example.com",
    timestamp: now,
    tzOffset: "+0000",
  },
  message: "Initial commit",
});
```

**Key APIs:**
- `CommitStore.storeCommit()` - Create commit object
- `CommitStore.loadCommit()` - Load commit by ID

**Commit Structure:**
```
commit {
  tree: ObjectId        // Root tree snapshot
  parents: ObjectId[]   // Parent commits (empty for initial)
  author: PersonIdent   // Who wrote the changes
  committer: PersonIdent // Who committed
  message: string       // Commit message
}
```

---

### Step 5: Update Branch Reference

Update the branch reference to point to the new commit.

```typescript
await repository.refs.set("refs/heads/main", commitId);
console.log("Branch updated: refs/heads/main");

// Verify
const head = await repository.getHead();
console.log(`HEAD points to: ${head?.slice(0, 7)}`);
```

**Key APIs:**
- `RefStore.set()` - Create/update reference
- `RefStore.resolve()` - Resolve ref to object ID
- `HistoryStore.getHead()` - Get current HEAD commit

---

### Step 6: View Commit History

Walk the commit history from any starting point.

```typescript
console.log("Commit history:");
for await (const historyCommitId of repository.commits.walkAncestry(commitId)) {
  const historyCommit = await repository.commits.loadCommit(historyCommitId);
  console.log(`  - ${historyCommit.message}`);
}
```

**Key APIs:**
- `CommitStore.walkAncestry()` - Traverse commit graph (returns ObjectIds)
- `CommitStore.loadCommit()` - Load commit object by ID

---

## Key Concepts

### Content-Addressable Storage

Git stores content using SHA-1 hashes. The hash is computed from the content, so:
- Identical content always produces the same hash
- The hash serves as both identifier and integrity check
- Storage automatically deduplicates identical content

### Object Types

| Type | Description | Contains |
|------|-------------|----------|
| blob | File content | Raw bytes |
| tree | Directory | List of (mode, name, id) entries |
| commit | Snapshot | tree, parents, author, message |
| tag | Annotated tag | object, type, tagger, message |

### References

Branches are simply pointers to commits:
- `refs/heads/main` - The main branch
- `refs/heads/feature` - Feature branches
- `HEAD` - Points to the current branch or commit

---

## Project Structure

```
apps/examples/01-quick-start/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    └── main.ts           # Complete workflow example
```

---

## Output Example

```
Repository initialized!
Blob stored: a1b2c3d
Tree stored: e4f5g6h
Commit created: i7j8k9l
Branch updated: refs/heads/main

HEAD points to: i7j8k9l
Commit message: "Initial commit"
Commit tree: e4f5g6h

Second commit: m0n1o2p

Commit history:
  - Add features section (parent: i7j8k9l)
  - Initial commit (initial)

Quick Start completed successfully!
```

---

## API Reference Links

### Core Package (packages/core)

| Interface/Class | Location | Purpose |
|-----------------|----------|---------|
| `HistoryStore` | [history/history-store.ts](../../../packages/core/src/history/history-store.ts) | Main repository interface |
| `createGitRepository()` | [stores/create-repository.ts](../../../packages/core/src/stores/create-repository.ts) | Repository factory function |
| `BlobStore` | [history/blobs/](../../../packages/core/src/history/blobs/) | Content storage |
| `TreeStore` | [history/trees/](../../../packages/core/src/history/trees/) | Directory structure management |
| `CommitStore` | [history/commits/](../../../packages/core/src/history/commits/) | Commit creation and traversal |
| `RefStore` | [history/refs/](../../../packages/core/src/history/refs/) | Branch and tag references |

---

## Next Steps

- [02-porcelain-commands](../02-porcelain-commands/) - Learn the high-level Git Commands API
- [03-object-model](../03-object-model/) - Deep dive into Git's object model
