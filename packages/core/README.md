# @statewalker/vcs-core

Core Git-compatible VCS types, interfaces, and operations for building version control systems.

## Overview

This package provides the foundational layer for building Git-compatible version control systems. It defines the core object model (blobs, trees, commits, tags), storage interfaces, and high-level operations that power the entire StateWalker VCS ecosystem. Think of it as the engine that drives all VCS functionality while remaining agnostic to how and where data is actually stored.

The design follows a clear separation between interfaces and implementations. The package defines what operations are possible (storing commits, managing references, tracking staged files) without dictating how storage backends implement them. This architecture enables the same VCS logic to work across diverse environments: browser-based IndexedDB storage, Node.js filesystem access, or cloud-based solutions.

All interfaces use streaming patterns with `AsyncIterable<Uint8Array>` to handle large files and repositories efficiently. Memory consumption stays bounded regardless of file sizes, making the library suitable for constrained environments like web browsers or edge deployments.

## Installation

```bash
pnpm add @statewalker/vcs-core
```

**Peer Dependencies:**
- `@statewalker/vcs-utils` - Required for compression, hashing, and delta algorithms

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
History (unified entry point for immutable objects)
├── Blobs (file contents, streaming)
├── Trees (directory snapshots)
├── Commits (history with ancestry traversal)
├── Tags (annotated tags)
└── Refs (branches, tags, HEAD)
```

Lower layers (RawStorage, ChunkAccess) handle raw storage and compression, while higher layers provide semantic operations like commit ancestry traversal or reference resolution.

### History vs WorkingCopy

The package separates immutable history from mutable local state:

| Concept | Purpose | Examples |
|---------|---------|----------|
| **History** | Immutable content-addressed objects | Commits, trees, blobs, tags, refs |
| **WorkingCopy** | Mutable local state | Staging area, HEAD, merge state, stash |

Multiple WorkingCopies can share a single History, similar to `git worktree`. This separation enables:

- Clean architectural boundaries
- Multiple parallel checkouts
- Clear ownership of state

```
WorkingCopy (mutable local state)
├── checkout (HEAD, staging, operation state)
├── worktreeInterface (filesystem access)
├── stash
├── config (per-worktree settings)
└── history (shared immutable objects)
        ├── blobs, trees, commits, tags
        └── refs (branches, tags, remotes)
```

**Note:** `HistoryStore` is the deprecated legacy interface. Use `History` for new code.

## Public API

### Main Export

```typescript
import {
  // New interfaces (recommended)
  type History,
  type HistoryWithOperations,
  type Blobs,
  type Trees,
  type Commits,
  type Tags,
  type Refs,
  type ObjectStorage,
  type Staging,
  type Checkout,
  type Worktree,
  type WorkingCopy,

  // Factory functions
  createHistoryWithOperations,
  createHistoryFromStores,
  createMemoryHistory,

  // Core types
  type ObjectId,
  type ObjectType,
  type TreeEntry,
  type Commit,
  type AnnotatedTag,
  type PersonIdent,
  type Ref,
  type SymbolicRef,

  // File modes
  FileMode,

  // Storage abstractions
  type RawStorage,
  type StorageBackend,

  // Deprecated (for migration)
  type HistoryStore,  // Use History instead
  type BlobStore,     // Use Blobs instead
  type TreeStore,     // Use Trees instead
  type CommitStore,   // Use Commits instead
  type TagStore,      // Use Tags instead
  type RefStore,      // Use Refs instead
  type StagingStore,  // Use Staging instead
} from "@statewalker/vcs-core";
```

### Sub-exports

| Export Path | Description |
|-------------|-------------|
| `@statewalker/vcs-core/types` | All type definitions |
| `@statewalker/vcs-core/stores` | Store interfaces |
| `@statewalker/vcs-core/staging` | Staging area types |
| `@statewalker/vcs-core/format` | Serialization utilities |

### Key Interfaces

**New Interfaces (Recommended):**

| Interface | Purpose |
|-----------|---------|
| `History` | Immutable object storage (blobs, trees, commits, tags, refs) |
| `HistoryWithOperations` | History with delta/serialization APIs |
| `ObjectStorage<V>` | Base interface for content-addressed stores |
| `Blobs` | File content (streaming I/O) |
| `Trees` | Directory snapshots with entry lookup |
| `Commits` | Commits with ancestry traversal and merge base detection |
| `Tags` | Annotated tags with target resolution |
| `Refs` | Branches, tags, HEAD management |
| `Staging` | Index with conflict resolution |
| `Checkout` | HEAD management and operation state |
| `Worktree` | Working directory filesystem access |
| `WorkingCopy` | Links History + Checkout + Worktree |
| `TransformationStore` | Merge, rebase, cherry-pick, revert state |
| `ResolutionStore` | Conflict detection and rerere |

**Deprecated Interfaces:**

| Interface | Replacement |
|-----------|-------------|
| `HistoryStore` | Use `History` |
| `BlobStore` | Use `Blobs` |
| `TreeStore` | Use `Trees` |
| `CommitStore` | Use `Commits` |
| `TagStore` | Use `Tags` |
| `RefStore` | Use `Refs` |
| `StagingStore` | Use `Staging` |
| `WorktreeStore` | Use `Worktree` |

## Usage Examples

### Working with the History Interface (Recommended)

The `History` interface provides unified access to all immutable objects:

```typescript
import type { History, Commit } from "@statewalker/vcs-core";
import { createMemoryHistory, FileMode } from "@statewalker/vcs-core";

// Create in-memory history for testing
const history = createMemoryHistory();
await history.initialize();

// Store a blob
const content = new TextEncoder().encode("Hello, World!");
const blobId = await history.blobs.store([content]);

// Create a tree
const treeId = await history.trees.store([
  { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId }
]);

// Create a commit
const commit: Commit = {
  tree: treeId,
  parents: [],
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
  message: "Initial commit",
};

const commitId = await history.commits.store(commit);
await history.refs.set("refs/heads/main", commitId);

await history.close();
```

### Using Legacy HistoryStore Interface

For backward compatibility, the deprecated `HistoryStore` interface still works:

```typescript
import type { HistoryStore, Commit } from "@statewalker/vcs-core";

async function createCommit(repo: HistoryStore, message: string): Promise<ObjectId> {
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

  // Store and update HEAD (legacy method names)
  const commitId = await repo.commits.storeCommit(commit);
  await repo.refs.set("refs/heads/main", commitId);

  return commitId;
}
```

### Working with WorkingCopy

The `WorkingCopy` interface provides access to local checkout state:

```typescript
import type { WorkingCopy } from "@statewalker/vcs-core";

async function checkWorkingCopyStatus(wc: WorkingCopy): Promise<void> {
  // Get current branch
  const branch = await wc.getCurrentBranch();
  console.log(`On branch: ${branch ?? "detached HEAD"}`);

  // Check for in-progress operations
  if (await wc.hasOperationInProgress()) {
    const mergeState = await wc.getMergeState();
    if (mergeState) {
      console.log(`Merge in progress: ${mergeState.mergeHead}`);
    }

    const rebaseState = await wc.getRebaseState();
    if (rebaseState) {
      console.log(`Rebase: step ${rebaseState.current}/${rebaseState.total}`);
    }
  }

  // Get status
  const status = await wc.getStatus();
  if (!status.isClean) {
    console.log("Working tree has uncommitted changes");
  }
}

// Using stash
async function stashChanges(wc: WorkingCopy, message: string): Promise<void> {
  const stashId = await wc.stash.push(message);
  console.log(`Created stash: ${stashId}`);

  // List stashes
  for await (const entry of wc.stash.list()) {
    console.log(`stash@{${entry.index}}: ${entry.message}`);
  }

  // Pop most recent
  await wc.stash.pop();
}
```

### Storing and Loading Blobs

```typescript
import type { BlobStore } from "@statewalker/vcs-core";

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
import type { TreeStore, TreeEntry } from "@statewalker/vcs-core";
import { FileMode } from "@statewalker/vcs-core";

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
import type { CommitStore } from "@statewalker/vcs-core";

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
import type { RefStore } from "@statewalker/vcs-core";

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
import type { StagingStore, StagingEntry } from "@statewalker/vcs-core";
import { FileMode } from "@statewalker/vcs-core";

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
import type { StatusCalculator, FileStatus } from "@statewalker/vcs-core";

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

### Repository State Detection

The `WorkingCopy` interface provides state detection for in-progress operations. This helps UIs show appropriate status messages and prevent conflicting operations.

```typescript
import { RepositoryState } from "@statewalker/vcs-core";
import type { WorkingCopy } from "@statewalker/vcs-core";

async function checkRepositoryState(wc: WorkingCopy): Promise<void> {
  const state = await wc.getState();
  const capabilities = await wc.getStateCapabilities();

  // Show current operation status
  switch (state) {
    case RepositoryState.SAFE:
      console.log("Repository is ready for any operation");
      break;
    case RepositoryState.MERGING:
      console.log("Merge in progress - resolve conflicts then commit");
      break;
    case RepositoryState.REBASING:
    case RepositoryState.REBASING_MERGE:
    case RepositoryState.REBASING_INTERACTIVE:
      console.log("Rebase in progress - continue, skip, or abort");
      break;
    case RepositoryState.CHERRY_PICKING:
      console.log("Cherry-pick in progress - resolve conflicts");
      break;
    case RepositoryState.REVERTING:
      console.log("Revert in progress - resolve conflicts");
      break;
    case RepositoryState.BISECTING:
      console.log("Bisect in progress");
      break;
  }

  // Check what operations are allowed
  if (!capabilities.canCheckout) {
    console.log("Cannot checkout - finish current operation first");
  }
  if (!capabilities.canCommit) {
    console.log("Cannot commit in current state");
  }
}
```

Available states mirror Git's internal states:

| State | Description |
|-------|-------------|
| `BARE` | Bare repository, no working tree |
| `SAFE` | Normal state, all operations allowed |
| `MERGING` | Merge with unresolved conflicts |
| `MERGING_RESOLVED` | Merge resolved, ready to commit |
| `CHERRY_PICKING` | Cherry-pick with conflicts |
| `CHERRY_PICKING_RESOLVED` | Cherry-pick resolved |
| `REVERTING` | Revert with conflicts |
| `REVERTING_RESOLVED` | Revert resolved |
| `REBASING` / `REBASING_MERGE` / `REBASING_INTERACTIVE` | Rebase in progress |
| `APPLY` | Git am (mailbox apply) in progress |
| `BISECTING` | Bisect in progress |

### Stash Operations

```typescript
import type { WorkingCopy } from "@statewalker/vcs-core";

async function useStash(wc: WorkingCopy): Promise<void> {
  // Save current work with a message
  const stashId = await wc.stash.push("WIP: fixing authentication");

  // Include untracked files (like git stash -u)
  await wc.stash.push({ message: "WIP with new files", includeUntracked: true });

  // List all stashes
  for await (const entry of wc.stash.list()) {
    console.log(`stash@{${entry.index}}: ${entry.message}`);
  }

  // Apply most recent stash
  await wc.stash.apply(0);

  // Pop (apply and remove)
  await wc.stash.pop();

  // Drop specific stash
  await wc.stash.drop(1);

  // Clear all stashes
  await wc.stash.clear();
}
```

Stash commits follow Git's structure with 2-3 parents:
- Parent 1: HEAD at time of stash
- Parent 2: Index state commit
- Parent 3 (optional): Untracked files commit (when `includeUntracked: true`)

## File Modes

The package exports standard Git file mode constants:

```typescript
import { FileMode } from "@statewalker/vcs-core";

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

The package defines interfaces with concrete implementations for Git-compatible file storage. Additional storage backends (like `@statewalker/vcs-store-sql` or `@statewalker/vcs-store-mem`) provide alternative implementations for SQL databases or in-memory testing.

### JGit Compatibility

Type definitions and constants align with Eclipse JGit for proven Git compatibility. This includes object type codes, reference storage types, and staging entry structures.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@statewalker/vcs-utils` | Compression, SHA-1 hashing, delta algorithms, file system abstraction |

## Related Packages

| Package | Description |
|---------|-------------|
| `@statewalker/vcs-store-sql` | SQLite-based storage backend |
| `@statewalker/vcs-store-mem` | In-memory storage for testing |
| `@statewalker/vcs-store-kv` | Key-value storage abstraction |
| `@statewalker/vcs-transport` | Git protocol and HTTP transport |
| `@statewalker/vcs-commands` | High-level Git commands |
| `@statewalker/vcs-testing` | Test utilities and fixtures |

## License

MIT
