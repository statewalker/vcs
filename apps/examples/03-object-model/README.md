# 03-object-model

Deep dive into Git's internal object model. This example demonstrates how Git stores data using four object types: blobs (file content), trees (directories), commits (snapshots), and tags (labels). Understanding these fundamentals is essential for working with Git at a low level.

## Quick Start

```bash
# From the monorepo root
pnpm install
pnpm --filter @statewalker/vcs-examples-03-object-model start
```

## Running Individual Steps

Each step can be run independently:

```bash
pnpm --filter @statewalker/vcs-examples-03-object-model step:01  # Blob storage
pnpm --filter @statewalker/vcs-examples-03-object-model step:02  # Tree structure
pnpm --filter @statewalker/vcs-examples-03-object-model step:03  # Commit anatomy
pnpm --filter @statewalker/vcs-examples-03-object-model step:04  # Tags
pnpm --filter @statewalker/vcs-examples-03-object-model step:05  # Deduplication
```

## What You'll Learn

- How Git stores file content (blobs)
- How Git represents directories (trees)
- The anatomy of a commit object
- Difference between lightweight and annotated tags
- Content-addressable storage and automatic deduplication

## Prerequisites

- Node.js 18+
- pnpm
- Completed [01-quick-start](../01-quick-start/)

---

## Step-by-Step Guide

### Step 1: Blob Storage

**File:** [src/steps/01-blob-storage.ts](src/steps/01-blob-storage.ts)

Blobs store file content. The SHA-1 hash of the content becomes the object ID.

```typescript
import { createGitRepository, createInMemoryFilesApi } from "@statewalker/vcs-core";

// Create repository
const files = createInMemoryFilesApi();
const repository = await createGitRepository(files, ".git", { create: true });

// Store content as a blob
const content = new TextEncoder().encode("Hello, World!");
const blobId = await repository.blobs.store([content]);

console.log(`Blob ID: ${blobId}`);  // SHA-1 hash

// Read content back
const chunks: Uint8Array[] = [];
for await (const chunk of repository.blobs.load(blobId)) {
  chunks.push(chunk);
}
const text = new TextDecoder().decode(chunks[0]);

// Get object metadata
const header = await repository.objects.getHeader(blobId);
console.log(`Type: ${header.type}`);   // "blob"
console.log(`Size: ${header.size}`);   // content length
```

**Key APIs:**
- `BlobStore.store()` - Store content, returns ObjectId (SHA-1 hash)
- `BlobStore.load()` - Load content as async iterable
- `ObjectStore.getHeader()` - Get object type and size

**Key Concepts:**
- The blob ID is the SHA-1 hash of `"blob {size}\0{content}"`
- Identical content always produces the same ID
- Blobs contain only raw bytes, no filename or metadata

---

### Step 2: Tree Structure

**File:** [src/steps/02-tree-structure.ts](src/steps/02-tree-structure.ts)

Trees represent directories. Each entry has a mode, name, and object ID.

```typescript
import { FileMode } from "@statewalker/vcs-core";

// Create blobs for files
const readmeId = await repository.blobs.store([encode("# Project")]);
const indexId = await repository.blobs.store([encode('console.log("Hi")')]);

// Create a tree (directory)
const treeId = await repository.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "README.md", id: readmeId },
  { mode: FileMode.REGULAR_FILE, name: "index.js", id: indexId },
]);

// Read tree entries (like `git ls-tree`)
for await (const entry of repository.trees.loadTree(treeId)) {
  console.log(`${entry.mode} ${entry.name} ${entry.id}`);
}

// Nested directories: trees can contain other trees
const srcTreeId = await repository.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "app.js", id: indexId },
]);

const rootTreeId = await repository.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "README.md", id: readmeId },
  { mode: FileMode.TREE, name: "src", id: srcTreeId },  // Subdirectory!
]);

// Look up specific entry
const entry = await repository.trees.getEntry(rootTreeId, "README.md");
```

**Key APIs:**
- `TreeStore.storeTree()` - Create tree from entries
- `TreeStore.loadTree()` - Stream tree entries
- `TreeStore.getEntry()` - Get single entry by name

**File Modes:**
| Mode | Constant | Description |
|------|----------|-------------|
| `040000` | `FileMode.TREE` | Directory |
| `100644` | `FileMode.REGULAR_FILE` | Regular file |
| `100755` | `FileMode.EXECUTABLE_FILE` | Executable file |
| `120000` | `FileMode.SYMLINK` | Symbolic link |
| `160000` | `FileMode.GITLINK` | Submodule reference |

---

### Step 3: Commit Anatomy

**File:** [src/steps/03-commit-anatomy.ts](src/steps/03-commit-anatomy.ts)

Commits link a tree snapshot to the history chain.

```typescript
// Create the commit
const now = Date.now() / 1000;
const commitId = await repository.commits.storeCommit({
  tree: treeId,
  parents: [],  // Empty for initial commit
  author: {
    name: "Alice Developer",
    email: "alice@example.com",
    timestamp: now,
    tzOffset: "-0500",
  },
  committer: {
    name: "Alice Developer",
    email: "alice@example.com",
    timestamp: now,
    tzOffset: "-0500",
  },
  message: "Initial commit\n\nThis is the first commit.",
});

// Load and inspect the commit
const commit = await repository.commits.loadCommit(commitId);

console.log(`tree:      ${commit.tree}`);
console.log(`parents:   ${commit.parents.join(", ") || "(none)"}`);
console.log(`author:    ${commit.author.name} <${commit.author.email}>`);
console.log(`timestamp: ${new Date(commit.author.timestamp * 1000).toISOString()}`);
console.log(`message:   ${commit.message}`);

// Second commit with parent reference
const commit2Id = await repository.commits.storeCommit({
  tree: newTreeId,
  parents: [commitId],  // Link to first commit
  author: { ... },
  committer: { ... },
  message: "Update README",
});
```

**Key APIs:**
- `CommitStore.storeCommit()` - Create commit object
- `CommitStore.loadCommit()` - Load commit by ID
- `CommitStore.walkAncestry()` - Traverse commit history

**Commit Structure:**
```
commit {
  tree: ObjectId           // Root tree snapshot
  parents: ObjectId[]      // Parent commits (0 for initial, 1 for normal, 2+ for merge)
  author: PersonIdent      // Who wrote the changes
  committer: PersonIdent   // Who applied the commit
  message: string          // Commit message
}
```

---

### Step 4: Tags

**File:** [src/steps/04-tags.ts](src/steps/04-tags.ts)

Tags mark specific commits. Lightweight tags are just refs; annotated tags are objects.

```typescript
import { ObjectType } from "@statewalker/vcs-core";

// Lightweight tag: just a ref pointing to a commit
await repository.refs.set("refs/tags/v1.0.0", commitId);

// Annotated tag: a tag object with metadata
const tagId = await repository.tags.storeTag({
  object: commitId,
  objectType: ObjectType.COMMIT,
  tag: "v2.0.0",
  tagger: {
    name: "Release Manager",
    email: "release@example.com",
    timestamp: Date.now() / 1000,
    tzOffset: "+0000",
  },
  message: "Version 2.0.0 release\n\nMajor version with breaking changes.",
});

// Create ref pointing to tag object
await repository.refs.set("refs/tags/v2.0.0", tagId);

// Load and inspect tag
const tag = await repository.tags.loadTag(tagId);
console.log(`object:     ${tag.object}`);
console.log(`objectType: ${tag.objectType}`);  // 1 = commit
console.log(`tag:        ${tag.tag}`);
console.log(`tagger:     ${tag.tagger?.name}`);
console.log(`message:    ${tag.message}`);
```

**Key APIs:**
- `TagStore.storeTag()` - Create annotated tag object
- `TagStore.loadTag()` - Load tag object
- `RefStore.set()` - Create lightweight tag (or ref to annotated tag)

**Lightweight vs Annotated:**
| Feature | Lightweight | Annotated |
|---------|-------------|-----------|
| Stored as | Ref only | Tag object + ref |
| Tagger info | No | Yes |
| Message | No | Yes |
| GPG signature | No | Optional |
| Use case | Quick bookmarks | Releases |

---

### Step 5: Deduplication

**File:** [src/steps/05-deduplication.ts](src/steps/05-deduplication.ts)

Content-addressable storage means identical content is stored only once.

```typescript
const content = "Hello, World!";

// Store the same content multiple times
const id1 = await storeBlob(repository, content);
const id2 = await storeBlob(repository, content);
const id3 = await storeBlob(repository, content);

// All IDs are identical!
console.log(id1 === id2);  // true
console.log(id2 === id3);  // true

// Content is stored only ONCE, regardless of how many times we store it

// Example: storing files with duplicate content
const files = [
  { name: "file1.txt", content: "Shared content" },
  { name: "file2.txt", content: "Shared content" },  // Duplicate!
  { name: "file3.txt", content: "Unique content" },
  { name: "file4.txt", content: "Shared content" },  // Duplicate!
];

const uniqueIds = new Set<string>();
for (const file of files) {
  const id = await storeBlob(repository, file.content);
  uniqueIds.add(id);
}

console.log(`Total files: ${files.length}`);      // 4
console.log(`Unique blobs: ${uniqueIds.size}`);  // 2
```

**Benefits of Content-Addressable Storage:**
1. **Automatic deduplication** - Same content stored once
2. **Efficient storage** - Similar files share blobs
3. **Fast comparison** - Same ID = same content
4. **Integrity verification** - Hash as checksum
5. **Efficient network transfer** - Send only unique objects

---

## Key Concepts

### Content-Addressable Storage

Git uses SHA-1 hashes to identify objects. The hash is computed from the content:
- Identical content always produces the same hash
- The hash serves as both identifier and integrity check
- Storage automatically deduplicates identical content

### Object Types

| Type | Description | Contains |
|------|-------------|----------|
| **blob** | File content | Raw bytes |
| **tree** | Directory | List of (mode, name, id) entries |
| **commit** | Snapshot | tree, parents, author, committer, message |
| **tag** | Annotated tag | object, objectType, tag, tagger, message |

### Object Storage Path

In Git's loose object storage, objects are stored at:
```
.git/objects/{first 2 chars}/{remaining 38 chars}
```

For example, blob `a1b2c3d4e5...` is stored at:
```
.git/objects/a1/b2c3d4e5...
```

---

## Project Structure

```
apps/examples/03-object-model/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── main.ts                     # Main entry point (runs all steps)
    ├── shared.ts                   # Shared utilities
    └── steps/
        ├── 01-blob-storage.ts      # Blob storage demonstration
        ├── 02-tree-structure.ts    # Tree structure demonstration
        ├── 03-commit-anatomy.ts    # Commit anatomy demonstration
        ├── 04-tags.ts              # Tags demonstration
        └── 05-deduplication.ts     # Deduplication demonstration
```

---

## API Reference Links

### Core Package (packages/core)

| Interface/Class | Location | Purpose |
|-----------------|----------|---------|
| `HistoryStore` | [history/history-store.ts](../../../packages/core/src/history/history-store.ts) | Main repository interface |
| `BlobStore` | [history/blobs/](../../../packages/core/src/history/blobs/) | Blob storage |
| `TreeStore` | [history/trees/](../../../packages/core/src/history/trees/) | Tree storage |
| `CommitStore` | [history/commits/](../../../packages/core/src/history/commits/) | Commit storage |
| `TagStore` | [history/tags/](../../../packages/core/src/history/tags/) | Tag storage |
| `RefStore` | [history/refs/](../../../packages/core/src/history/refs/) | Reference storage |
| `ObjectStore` | [history/objects/](../../../packages/core/src/history/objects/) | Low-level object storage |

### Types

| Type | Description |
|------|-------------|
| `ObjectId` | SHA-1 hash as string (40 hex chars) |
| `PersonIdent` | Author/committer identity (name, email, timestamp, tzOffset) |
| `FileMode` | File type constants (TREE, REGULAR_FILE, etc.) |
| `TreeEntry` | Tree entry (mode, name, id) |
| `Commit` | Commit object structure |
| `AnnotatedTag` | Tag object structure |
| `ObjectType` | Object type codes (COMMIT=1, TREE=2, BLOB=3, TAG=4) |

---

## Output Example

```
============================================================
  Object Model Example
============================================================

--- Step 1: Blob Storage ---

  >> Storing content as a blob

  Content: "Hello, World! This is my first blob."
  Blob ID: 7b541fb8e12f8a65c0d8b9b0e0f0a1b2c3d4e5f6
  Short ID: 7b541fb

  >> Understanding the ID

  The blob ID is a SHA-1 hash of the content.
  Git prefixes the content with "blob {size}\0" before hashing.
  This creates a unique identifier based on content.

  >> Reading blob content back

  Retrieved content: "Hello, World! This is my first blob."
  Content matches: true

  >> Getting object metadata

  Object type: blob
  Object size: 37 bytes

Step 1 completed!

--- Step 2: Tree Structure ---

  >> Creating files for the tree

  Created blobs:
    README.md:     a1b2c3d
    index.js:      e4f5g6h
    package.json:  i7j8k9l

  >> Creating a tree

  Tree ID: m0n1o2p

  >> Reading tree entries

  Tree entries (like 'git ls-tree'):
    100644 blob a1b2c3d  README.md
    100644 blob e4f5g6h  index.js
    100644 blob i7j8k9l  package.json

Step 2 completed!
...
```

---

## Next Steps

- [04-branching-merging](../04-branching-merging/) - Advanced branching and merging
- [06-internal-storage](../06-internal-storage/) - Storage internals (loose objects, pack files)
