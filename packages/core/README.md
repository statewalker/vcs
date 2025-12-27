# @webrun-vcs/core

Core Git-compatible VCS types, interfaces, and operations for building version control systems.

## Overview

This package provides the foundational layer for building Git-compatible version control systems. It defines the core object model (blobs, trees, commits, tags), storage interfaces, and high-level operations that power the entire WebRun VCS ecosystem. Think of it as the engine that drives all VCS functionality while remaining agnostic to how and where data is actually stored.

The design follows a clear separation between interfaces and implementations. The package defines what operations are possible (storing commits, managing references, tracking staged files) without dictating how storage backends implement them. This architecture enables the same VCS logic to work across diverse environments: browser-based IndexedDB storage, Node.js filesystem access, or cloud-based solutions.

All interfaces use streaming patterns with `AsyncIterable<Uint8Array>` to handle large files and repositories efficiently. Memory consumption stays bounded regardless of file sizes, making the library suitable for constrained environments like web browsers or edge deployments.

## Installation

```bash
pnpm add @webrun-vcs/core
```

**Peer Dependencies:**
- `@webrun-vcs/utils` - Required for compression, hashing, and delta algorithms

## Core Concepts

### Git Object Model

Git stores all content as four object types, each identified by a SHA-1 hash of its contents:

| Type | Description | Example |
|------|-------------|---------|
| **Blob** | Raw file content | Source code, images, binaries |
| **Tree** | Directory listing | Maps names to blobs/trees with file modes |
| **Commit** | Snapshot with metadata | Points to tree, parents, author, message |
| **Tag** | Annotated reference | Named pointer with tagger info and message |

This content-addressable design means identical content always produces identical IDs, enabling deduplication and integrity verification.

### Store Hierarchy

The package organizes storage in layers, from raw bytes to semantic objects:

```
Repository (unified entry point)
├── GitObjectStore (unified object storage with type headers)
│   ├── BlobStore (file contents)
│   ├── TreeStore (directory snapshots)
│   ├── CommitStore (history with ancestry traversal)
│   └── TagStore (annotated tags)
├── RefStore (branches, tags, HEAD)
├── StagingStore (index/staging area)
└── Config (repository settings)
```

Lower layers handle raw storage and compression, while higher layers provide semantic operations like commit ancestry traversal or reference resolution.

## Public API

### Main Export

```typescript
import {
  // Repository interface
  type Repository,
  type GitStores,
  type RepositoryConfig,

  // Object stores
  type GitObjectStore,
  type BlobStore,
  type TreeStore,
  type CommitStore,
  type TagStore,

  // Reference management
  type RefStore,
  type Ref,
  type SymbolicRef,

  // Staging area
  type StagingStore,
  type StagingEntry,
  type StagingBuilder,

  // Core types
  type ObjectId,
  type ObjectType,
  type TreeEntry,
  type Commit,
  type AnnotatedTag,
  type PersonIdent,

  // File modes
  FileMode,

  // Commands
  type Add,
  type Checkout,
} from "@webrun-vcs/core";
```

### Sub-exports

| Export Path | Description |
|-------------|-------------|
| `@webrun-vcs/core/types` | All type definitions |
| `@webrun-vcs/core/stores` | Store interfaces |
| `@webrun-vcs/core/staging` | Staging area types |
| `@webrun-vcs/core/format` | Serialization utilities |

### Key Interfaces

| Interface | Purpose |
|-----------|---------|
| `Repository` | Unified entry point combining all stores |
| `GitObjectStore` | Store/load any Git object by type |
| `BlobStore` | Binary file content storage |
| `TreeStore` | Directory structure snapshots |
| `CommitStore` | Commits with ancestry traversal |
| `TagStore` | Annotated tag objects |
| `RefStore` | Branches, tags, HEAD management |
| `StagingStore` | Index with conflict support |
| `StatusCalculator` | Three-way diff (HEAD/index/worktree) |
| `WorkingTreeIterator` | Filesystem traversal |

## Usage Examples

### Working with the Repository Interface

The `Repository` interface provides unified access to all VCS operations:

```typescript
import type { Repository, Commit } from "@webrun-vcs/core";

async function createCommit(repo: Repository, message: string): Promise<ObjectId> {
  // Get current HEAD
  const headRef = await repo.refs.resolve("HEAD");
  const parentId = headRef?.objectId;

  // Build tree from staging area
  const treeId = await repo.staging.writeTree(repo.trees);

  // Create commit object
  const commit: Commit = {
    tree: treeId,
    parents: parentId ? [parentId] : [],
    author: {
      name: "Developer",
      email: "dev@example.com",
      timestamp: Math.floor(Date.now() / 1000),
      tzOffset: "+0000",
    },
    committer: {
      name: "Developer",
      email: "dev@example.com",
      timestamp: Math.floor(Date.now() / 1000),
      tzOffset: "+0000",
    },
    message,
  };

  // Store and update HEAD
  const commitId = await repo.commits.storeCommit(commit);
  await repo.refs.set("refs/heads/main", commitId);

  return commitId;
}
```

### Storing and Loading Blobs

```typescript
import type { BlobStore } from "@webrun-vcs/core";

async function storeFile(blobs: BlobStore, content: string): Promise<ObjectId> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content);

  // Store returns the content-addressed ID
  const id = await blobs.store([bytes]);
  console.log(`Stored blob: ${id}`);

  return id;
}

async function loadFile(blobs: BlobStore, id: ObjectId): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of blobs.load(id)) {
    chunks.push(chunk);
  }

  const decoder = new TextDecoder();
  return decoder.decode(concat(chunks));
}
```

### Building Trees

```typescript
import type { TreeStore, TreeEntry } from "@webrun-vcs/core";
import { FileMode } from "@webrun-vcs/core";

async function buildTree(trees: TreeStore, blobs: BlobStore): Promise<ObjectId> {
  // Store file contents first
  const readmeId = await blobs.store([new TextEncoder().encode("# My Project")]);
  const srcIndexId = await blobs.store([new TextEncoder().encode("export {};\n")]);

  // Create src/ subtree
  const srcTreeId = await trees.storeTree([
    { mode: FileMode.REGULAR_FILE, name: "index.ts", id: srcIndexId },
  ]);

  // Create root tree
  const rootTreeId = await trees.storeTree([
    { mode: FileMode.REGULAR_FILE, name: "README.md", id: readmeId },
    { mode: FileMode.TREE, name: "src", id: srcTreeId },
  ]);

  return rootTreeId;
}
```

### Traversing Commit History

```typescript
import type { CommitStore } from "@webrun-vcs/core";

async function* getHistory(
  commits: CommitStore,
  startId: ObjectId,
  limit = 100
): AsyncIterable<{ id: ObjectId; commit: Commit }> {
  for await (const id of commits.walkAncestry([startId], { limit })) {
    const commit = await commits.loadCommit(id);
    yield { id, commit };
  }
}

// Usage
for await (const { id, commit } of getHistory(repo.commits, headId)) {
  console.log(`${id.slice(0, 7)} ${commit.message.split("\n")[0]}`);
}
```

### Managing References

```typescript
import type { RefStore } from "@webrun-vcs/core";

async function createBranch(refs: RefStore, name: string, commitId: ObjectId): Promise<void> {
  const refName = `refs/heads/${name}`;
  await refs.set(refName, commitId);
}

async function getCurrentBranch(refs: RefStore): Promise<string | undefined> {
  const head = await refs.get("HEAD");
  if (head && "target" in head) {
    // HEAD is a symbolic ref pointing to a branch
    return head.target.replace("refs/heads/", "");
  }
  return undefined; // Detached HEAD
}

async function listBranches(refs: RefStore): Promise<string[]> {
  const branches: string[] = [];
  for await (const ref of refs.list("refs/heads/")) {
    branches.push(ref.name.replace("refs/heads/", ""));
  }
  return branches;
}
```

### Working with the Staging Area

```typescript
import type { StagingStore, StagingEntry } from "@webrun-vcs/core";
import { FileMode } from "@webrun-vcs/core";

async function stageFile(
  staging: StagingStore,
  path: string,
  objectId: ObjectId
): Promise<void> {
  const editor = staging.editor();
  editor.add({
    path,
    apply: () => ({
      path,
      mode: FileMode.REGULAR_FILE,
      objectId,
      stage: 0, // MERGED (no conflict)
      size: 0,
      mtime: Date.now(),
    }),
  });
  await editor.finish();
}

async function listStagedFiles(staging: StagingStore): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of staging.listEntries()) {
    paths.push(entry.path);
  }
  return paths;
}
```

### Calculating Repository Status

```typescript
import type { StatusCalculator, FileStatus } from "@webrun-vcs/core";

async function showStatus(calculator: StatusCalculator): Promise<void> {
  const status = await calculator.calculateStatus({
    includeUntracked: true,
  });

  console.log(`On branch: ${status.branch ?? "detached HEAD"}`);

  if (status.isClean) {
    console.log("Nothing to commit, working tree clean");
    return;
  }

  for (const file of status.files) {
    const staged = file.indexStatus !== FileStatus.UNMODIFIED ? "S" : " ";
    const worktree = file.workTreeStatus !== FileStatus.UNMODIFIED ? "W" : " ";
    console.log(`${staged}${worktree} ${file.path}`);
  }
}
```

## File Modes

The package exports standard Git file mode constants:

```typescript
import { FileMode } from "@webrun-vcs/core";

FileMode.TREE           // 0o040000 - Directory
FileMode.REGULAR_FILE   // 0o100644 - Normal file
FileMode.EXECUTABLE_FILE // 0o100755 - Executable
FileMode.SYMLINK        // 0o120000 - Symbolic link
FileMode.GITLINK        // 0o160000 - Submodule reference
```

## Architecture Notes

### Streaming by Default

All interfaces use `AsyncIterable<Uint8Array>` for content to handle arbitrarily large files:

```typescript
interface BlobStore {
  store(content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId>;
  load(id: ObjectId): AsyncIterable<Uint8Array>;
}
```

### Interface/Implementation Separation

The package defines interfaces but not concrete implementations. Storage backends (like `@webrun-vcs/storage-git` or `@webrun-vcs/store-sql`) provide implementations tailored to their storage mechanisms.

### JGit Compatibility

Type definitions and constants align with Eclipse JGit for proven Git compatibility. This includes object type codes, reference storage types, and staging entry structures.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@webrun-vcs/utils` | Compression, SHA-1 hashing, delta algorithms |
| `@statewalker/webrun-files` | File system abstraction |

## Related Packages

| Package | Description |
|---------|-------------|
| `@webrun-vcs/store-sql` | SQLite-based storage backend |
| `@webrun-vcs/store-mem` | In-memory storage for testing |
| `@webrun-vcs/store-kv` | Key-value storage abstraction |
| `@webrun-vcs/transport` | Git protocol and HTTP transport |
| `@webrun-vcs/commands` | High-level Git commands |
| `@webrun-vcs/testing` | Test utilities and fixtures |

## License

MIT
