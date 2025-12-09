# Basic Git Cycle Example

This example application demonstrates the complete Git workflow using the webrun-vcs library. It shows how to create repositories, manage files, make commits, view history, and restore specific versions.

## Quick Start

```bash
# From the monorepo root
pnpm install
pnpm --filter @webrun-vcs/example-git-cycle start
```

## Running Individual Steps

Each step can be run independently:

```bash
pnpm --filter @webrun-vcs/example-git-cycle step:01  # Initialize repository
pnpm --filter @webrun-vcs/example-git-cycle step:02  # Create files (blobs)
pnpm --filter @webrun-vcs/example-git-cycle step:03  # Build trees
pnpm --filter @webrun-vcs/example-git-cycle step:04  # Create commits
pnpm --filter @webrun-vcs/example-git-cycle step:05  # Update files
pnpm --filter @webrun-vcs/example-git-cycle step:06  # View history
pnpm --filter @webrun-vcs/example-git-cycle step:07  # Restore version
pnpm --filter @webrun-vcs/example-git-cycle step:08  # Branches and tags
```

## Step-by-Step Guide

### Step 1: Initialize Repository

**File:** [src/steps/01-init-repository.ts](src/steps/01-init-repository.ts)

Creates a new Git repository with the standard directory structure.

```typescript
import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import { createGitStorage } from "@webrun-vcs/storage-git";

// Create file system (in-memory for this example)
const files = new FilesApi(new MemFilesApi());

// Initialize repository
const storage = await createGitStorage(files, "/repo/.git", {
  create: true,
  defaultBranch: "main"
});
```

**Key APIs:**
- [`createGitStorage()`](../../packages/storage-git/src/git-storage.ts#L187) - Factory function for creating/opening repos
- [`GitStorage.init()`](../../packages/storage-git/src/git-storage.ts#L111) - Initialize a new repository
- [`GitStorage.open()`](../../packages/storage-git/src/git-storage.ts#L93) - Open existing repository

**Created Structure:**
```
.git/
├── HEAD              (symbolic ref to refs/heads/main)
├── config            (repository configuration)
├── objects/          (object database)
└── refs/
    ├── heads/        (branch references)
    └── tags/         (tag references)
```

---

### Step 2: Create Files (Blobs)

**File:** [src/steps/02-create-files.ts](src/steps/02-create-files.ts)

Stores file content as Git blob objects. Blobs are content-addressable: identical content produces identical IDs.

```typescript
// Store text as a blob
const content = new TextEncoder().encode("Hello, World!");
const id = await storage.objects.store([content]);

// Read blob content
const chunks: Uint8Array[] = [];
for await (const chunk of storage.objects.load(id)) {
  chunks.push(chunk);
}
const text = new TextDecoder().decode(chunks[0]);

// Check size and existence
const size = await storage.objects.getSize(id);
const exists = await storage.objects.has(id);
```

**Key APIs:**
- [`ObjectStorage.store()`](../../packages/storage/src/object-storage.ts) - Store content chunks, returns ObjectId
- [`ObjectStorage.load()`](../../packages/storage/src/object-storage.ts) - Load content as async iterable
- [`ObjectStorage.getSize()`](../../packages/storage/src/object-storage.ts) - Get object size (-1 if not found)
- [`ObjectStorage.has()`](../../packages/storage/src/object-storage.ts) - Check if object exists

**Key Concepts:**
- Content is hashed (SHA-1) to produce the ObjectId
- Identical content automatically deduplicates
- Storage uses streaming for memory efficiency

---

### Step 3: Build Directory Structure (Trees)

**File:** [src/steps/03-build-trees.ts](src/steps/03-build-trees.ts)

Creates Git tree objects representing directories. Trees contain entries with mode, name, and object ID.

```typescript
import { FileMode } from "@webrun-vcs/storage";

// Create a tree with files
const treeId = await storage.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "README.md", id: readmeBlobId },
  { mode: FileMode.REGULAR_FILE, name: "index.js", id: indexBlobId },
  { mode: FileMode.TREE, name: "src", id: srcTreeId }  // Subdirectory
]);

// Load tree entries
for await (const entry of storage.trees.loadTree(treeId)) {
  console.log(`${entry.mode} ${entry.name} ${entry.id}`);
}
```

**Key APIs:**
- [`FileTreeStorage.storeTree()`](../../packages/storage/src/file-tree-storage.ts#L58) - Create tree from entries
- [`FileTreeStorage.loadTree()`](../../packages/storage/src/file-tree-storage.ts#L70) - Load entries as stream
- [`FileTreeStorage.getEntry()`](../../packages/storage/src/file-tree-storage.ts#L82) - Get single entry by name

**File Modes:**
| Mode | Constant | Description |
|------|----------|-------------|
| `040000` | `FileMode.TREE` | Directory |
| `100644` | `FileMode.REGULAR_FILE` | Regular file |
| `100755` | `FileMode.EXECUTABLE_FILE` | Executable file |
| `120000` | `FileMode.SYMLINK` | Symbolic link |
| `160000` | `FileMode.GITLINK` | Submodule |

---

### Step 4: Create Commits

**File:** [src/steps/04-create-commits.ts](src/steps/04-create-commits.ts)

Creates Git commit objects that link tree snapshots to history.

```typescript
// Create a commit
const commitId = await storage.commits.storeCommit({
  tree: treeId,
  parents: [],  // Empty for initial commit
  author: {
    name: "John Doe",
    email: "john@example.com",
    timestamp: Math.floor(Date.now() / 1000),
    tzOffset: "+0000"
  },
  committer: {
    name: "John Doe",
    email: "john@example.com",
    timestamp: Math.floor(Date.now() / 1000),
    tzOffset: "+0000"
  },
  message: "Initial commit"
});

// Update branch reference
await storage.refs.setRef("refs/heads/main", commitId);
```

**Key APIs:**
- [`CommitStorage.storeCommit()`](../../packages/storage/src/commit-storage.ts#L65) - Create commit object
- [`CommitStorage.loadCommit()`](../../packages/storage/src/commit-storage.ts#L74) - Load commit by ID
- [`RefDirectory.setRef()`](../../packages/storage-git/src/refs/ref-directory.ts#L105) - Update branch reference

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

### Step 5: Update Files (Add, Modify, Remove)

**File:** [src/steps/05-update-files.ts](src/steps/05-update-files.ts)

Demonstrates the complete file modification cycle.

**Adding Files:**
```typescript
// Store new blob
const newFileId = await storeBlob(storage, "new content");

// Create tree with new file added
const newTreeId = await storage.trees.storeTree([
  ...existingEntries,
  { mode: FileMode.REGULAR_FILE, name: "new-file.txt", id: newFileId }
]);
```

**Modifying Files:**
```typescript
// Store updated content (creates new blob)
const updatedId = await storeBlob(storage, "updated content");

// Create tree with updated entry
const updatedTreeId = await storage.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "file.txt", id: updatedId },
  // Other unchanged entries keep their original IDs
]);
```

**Removing Files:**
```typescript
// Create tree WITHOUT the entry to remove
const reducedTreeId = await storage.trees.storeTree([
  // Include all entries EXCEPT the one to delete
  { mode: FileMode.REGULAR_FILE, name: "keep-this.txt", id: keepId }
  // "deleted-file.txt" is simply not included
]);
```

**Key Concept:** Unchanged files reference the same blob IDs, enabling efficient storage through deduplication.

---

### Step 6: View Version History

**File:** [src/steps/06-view-history.ts](src/steps/06-view-history.ts)

Traverses and queries the commit history.

```typescript
// Get current HEAD
const headId = await storage.getHead();

// Walk full history
for await (const commitId of storage.commits.walkAncestry(headId)) {
  const commit = await storage.commits.loadCommit(commitId);
  console.log(`${commitId}: ${commit.message}`);
}

// Limited walk
for await (const id of storage.commits.walkAncestry(headId, { limit: 5 })) {
  // Only last 5 commits
}

// Check ancestry
const isAncestor = await storage.commits.isAncestor(commit1, commit2);
```

**Key APIs:**
- [`CommitStorage.walkAncestry()`](../../packages/storage/src/commit-storage.ts#L102) - Traverse commit graph
- [`CommitStorage.getParents()`](../../packages/storage/src/commit-storage.ts#L82) - Get parent commits
- [`CommitStorage.isAncestor()`](../../packages/storage/src/commit-storage.ts#L130) - Check relationships

**Traversal Options:**
```typescript
interface AncestryOptions {
  limit?: number;           // Max commits to traverse
  stopAt?: ObjectId[];      // Stop at these commits
  firstParentOnly?: boolean; // Linear history only
}
```

---

### Step 7: Restore Specific Version

**File:** [src/steps/07-restore-version.ts](src/steps/07-restore-version.ts)

Accesses files from any point in history.

```typescript
// Load commit at target version
const targetCommit = await storage.commits.loadCommit(targetId);

// List files in that tree
for await (const entry of storage.trees.loadTree(targetCommit.tree)) {
  console.log(entry.name);
}

// Read specific file
const entry = await storage.trees.getEntry(targetCommit.tree, "README.md");
const content = await readBlob(storage, entry.id);

// Create "revert" commit to restore state
const revertId = await storage.commits.storeCommit({
  tree: targetCommit.tree,  // Use old tree
  parents: [currentHead],   // Current HEAD as parent
  author, committer,
  message: `Revert to ${targetId}`
});
```

**Key Pattern:** Each commit contains a complete tree snapshot, so "restoring" means accessing that tree's files or creating a new commit with that tree.

---

### Step 8: Working with Branches and Tags

**File:** [src/steps/08-branches-tags.ts](src/steps/08-branches-tags.ts)

Manages references for branches and tags.

**Branches:**
```typescript
// Create branch
await storage.refs.setRef("refs/heads/feature", commitId);

// Switch branch
await storage.refs.setHead("feature");

// Get current branch
const branch = await storage.getCurrentBranch();

// List branches
const branches = await storage.refs.getBranches();

// Delete branch
await storage.refs.delete("refs/heads/feature");
```

**Lightweight Tags:**
```typescript
// Just a ref pointing to commit
await storage.refs.setRef("refs/tags/v1.0.0", commitId);
```

**Annotated Tags:**
```typescript
import { ObjectType } from "@webrun-vcs/storage";

// Create tag object
const tagId = await storage.tags.storeTag({
  object: commitId,
  objectType: ObjectType.COMMIT,
  tag: "v2.0.0",
  tagger: { name, email, timestamp, tzOffset },
  message: "Release version 2.0.0"
});

// Create ref pointing to tag object
await storage.refs.setRef("refs/tags/v2.0.0", tagId);
```

**Key APIs:**
- [`RefDirectory.setRef()`](../../packages/storage-git/src/refs/ref-directory.ts#L105) - Create/update ref
- [`RefDirectory.setHead()`](../../packages/storage-git/src/refs/ref-directory.ts#L112) - Change HEAD
- [`RefDirectory.getBranches()`](../../packages/storage-git/src/refs/ref-directory.ts#L83) - List branches
- [`RefDirectory.getTags()`](../../packages/storage-git/src/refs/ref-directory.ts#L88) - List tags
- [`TagStorage.storeTag()`](../../packages/storage/src/tag-storage.ts#L51) - Create annotated tag

---

## Project Structure

```
apps/example-git-cycle/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── main.ts                         # Main entry point
    ├── shared/
    │   └── index.ts                    # Shared utilities
    └── steps/
        ├── 01-init-repository.ts       # Repository initialization
        ├── 02-create-files.ts          # Blob storage
        ├── 03-build-trees.ts           # Tree creation
        ├── 04-create-commits.ts        # Commit creation
        ├── 05-update-files.ts          # File modifications
        ├── 06-view-history.ts          # History traversal
        ├── 07-restore-version.ts       # Version restoration
        └── 08-branches-tags.ts         # Branch/tag management
```

## API Reference Links

### Core Interfaces (packages/storage)

| Interface | File | Purpose |
|-----------|------|---------|
| `ObjectStorage` | [object-storage.ts](../../packages/storage/src/object-storage.ts) | Content-addressable blob storage |
| `FileTreeStorage` | [file-tree-storage.ts](../../packages/storage/src/file-tree-storage.ts) | Directory snapshot management |
| `CommitStorage` | [commit-storage.ts](../../packages/storage/src/commit-storage.ts) | Commit creation and traversal |
| `TagStorage` | [tag-storage.ts](../../packages/storage/src/tag-storage.ts) | Annotated tag management |

### Git Implementation (packages/storage-git)

| Class/Interface | File | Purpose |
|-----------------|------|---------|
| `GitStorage` | [git-storage.ts](../../packages/storage-git/src/git-storage.ts) | Main repository entry point |
| `RefDirectory` | [ref-directory.ts](../../packages/storage-git/src/refs/ref-directory.ts) | Branch and tag references |
| `GitObjectStorage` | [git-object-storage.ts](../../packages/storage-git/src/git-object-storage.ts) | Loose + pack object access |

### Types (packages/storage)

| Type | File | Description |
|------|------|-------------|
| `ObjectId` | [types.ts](../../packages/storage/src/types.ts#L7) | SHA-1 hash as hex string |
| `PersonIdent` | [types.ts](../../packages/storage/src/types.ts#L67) | Author/committer identity |
| `FileMode` | [types.ts](../../packages/storage/src/types.ts#L45) | File type constants |
| `Commit` | [commit-storage.ts](../../packages/storage/src/commit-storage.ts#L17) | Commit object structure |
| `TreeEntry` | [file-tree-storage.ts](../../packages/storage/src/file-tree-storage.ts#L14) | Tree entry structure |

## Related Examples

- [examples-git](../examples-git/) - Pack file and format examples
- [perf-bench](../perf-bench/) - Performance benchmarking

## Further Reading

- [JGit Source](../../tmp/jgit/org.eclipse.jgit/) - Reference implementation
- [Git Internals](https://git-scm.com/book/en/v2/Git-Internals-Plumbing-and-Porcelain) - Git book chapter
