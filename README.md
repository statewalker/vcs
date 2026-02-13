# StateWalker VCS

A TypeScript implementation of Git-compatible version control, designed for content-addressable storage with delta compression. This library enables reading and writing Git repositories directly in JavaScript environments, including browsers.

## Goal

StateWalker VCS provides a portable, streaming-oriented implementation of Git's core object model. It allows applications to work with Git repositories without relying on native Git binaries or specific file system APIs.

The library focuses on three main capabilities:

**Content-Addressable Storage** - Store and retrieve objects by their SHA-1 hash. Identical content automatically deduplicates, making storage efficient for version control workloads.

**Delta Compression** - Reduce storage requirements by computing and storing differences between similar objects. The implementation supports multiple delta strategies including rsync-style rolling checksums and Myers diff algorithm.

**Git Compatibility** - Read and write standard Git pack files, loose objects, and refs. Repositories created with StateWalker VCS work with native Git tools and vice versa.

## Package Structure

The monorepo contains packages organized by responsibility:

### Core Packages

**[@statewalker/vcs-core](packages/core)** provides the foundational layer for building Git-compatible version control systems. It defines the core object model (blobs, trees, commits, tags), storage interfaces, and high-level operations. Includes Git file storage for reading and writing the standard `.git` directory structure.

**[@statewalker/vcs-utils](packages/utils)** provides foundational algorithms including zlib compression/decompression, SHA-1 hashing with streaming support, and diff algorithms for computing deltas between binary content.

**[@statewalker/vcs-commands](packages/commands)** offers a high-level Git command API. Rather than working directly with low-level stores, you interact through familiar commands like `add`, `commit`, `push`, and `merge`.

**[@statewalker/vcs-transport](packages/transport)** implements the Git wire protocol (v1/v2), HTTP transport, and push/pull negotiation for communicating with remote repositories.

### Storage Adapters

**[@statewalker/vcs-store-mem](packages/store-mem)** provides in-memory storage for testing and development scenarios with no persistence.

**[@statewalker/vcs-store-sql](packages/store-sql)** provides SQL-based storage using better-sqlite3. Objects, refs, and metadata persist in SQLite tables.

**[@statewalker/vcs-store-kv](packages/store-kv)** bridges VCS storage interfaces to key-value stores like IndexedDB, LocalStorage, or LevelDB.

### Development Utilities

**[@statewalker/vcs-testing](packages/testing)** contains shared test utilities and fixtures used across packages.

**[@statewalker/vcs-sandbox](packages/sandbox)** provides sandbox utilities for isolated testing environments.

## Installation

```bash
# Install all dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test
```

## Usage

### Basic Repository Operations

The example application in [apps/example-git-cycle](apps/example-git-cycle) demonstrates the complete Git workflow. Here's a condensed version using the new History interface:

```typescript
import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import { createHistoryWithOperations, FileMode } from "@statewalker/vcs-core";

// Initialize an in-memory repository using the History interface
const files = new FilesApi(new MemFilesApi());
const history = await createHistoryWithOperations({ backend: createGitFilesBackend(files, ".git") });
await history.initialize();

// Store a file as a blob
const content = new TextEncoder().encode("Hello, World!");
const blobId = await history.blobs.store([content]);

// Create a tree (directory snapshot)
const treeId = await history.trees.store([
  { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId }
]);

// Create a commit
const commitId = await history.commits.store({
  tree: treeId,
  parents: [],
  author: { name: "Alice", email: "alice@example.com", timestamp: Date.now() / 1000, tzOffset: "+0000" },
  committer: { name: "Alice", email: "alice@example.com", timestamp: Date.now() / 1000, tzOffset: "+0000" },
  message: "Initial commit"
});

// Update the branch reference
await history.refs.set("refs/heads/main", commitId);

await history.close();
```

> **Runnable example:** [apps/example-readme-scripts/src/basic-repository-operations.ts](apps/example-readme-scripts/src/basic-repository-operations.ts)

### Working with Pack Files

For performance benchmarks and pack file operations, see [apps/example-git-perf](apps/example-git-perf). This example clones the Git source repository and demonstrates traversing commit history and reading delta-compressed objects.

### Using the Commands API

For a higher-level API, use `@statewalker/vcs-commands` which provides Git-like commands:

```typescript
import { Git } from "@statewalker/vcs-commands";
import { createWorkingCopy } from "@statewalker/vcs-core";

// Create working copy (links history + checkout + worktree)
const workingCopy = await createWorkingCopy(/* ... */);
const git = Git.fromWorkingCopy(workingCopy);

// Stage and commit (like git add && git commit)
await git.add().addFilepattern(".").call();
await git.commit().setMessage("Initial commit").call();

// Check status
const status = await git.status().call();
console.log("Clean:", status.isClean());

// Create branches, merge, push, and more
await git.branchCreate().setName("feature").call();
await git.checkout().setName("feature").call();
```

> **Runnable example:** [apps/example-readme-scripts/src/commands-api.ts](apps/example-readme-scripts/src/commands-api.ts)
> Note: The `git.add()` command requires a working tree iterator. The runnable example demonstrates an in-memory approach using direct staging manipulation.

### Delta Compression

The library uses format-agnostic delta storage for efficient pack files:

```typescript
import { applyDelta, createDelta, createDeltaRanges } from "@statewalker/vcs-utils/diff";

const baseContent = new TextEncoder().encode("Original file content");
const newContent = new TextEncoder().encode("Original file content with additions");

// Step 1: Compute delta ranges (identifies copy vs insert regions)
const ranges = [...createDeltaRanges(baseContent, newContent)];

// Step 2: Create delta instructions from ranges
const delta = [...createDelta(baseContent, newContent, ranges)];

// Step 3: Apply delta to reconstruct new content
const chunks = [...applyDelta(baseContent, delta)];
const reconstructed = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
let offset = 0;
for (const chunk of chunks) {
  reconstructed.set(chunk, offset);
  offset += chunk.length;
}
```

> **Runnable example:** [apps/example-readme-scripts/src/delta-compression.ts](apps/example-readme-scripts/src/delta-compression.ts)

## Core Interfaces

### History - Immutable Repository Objects

The History interface provides unified access to content-addressed objects:

```typescript
interface History {
  readonly blobs: Blobs;     // File content (streaming)
  readonly trees: Trees;     // Directory snapshots
  readonly commits: Commits; // Version history with ancestry
  readonly tags: Tags;       // Annotated tags
  readonly refs: Refs;       // Branch/tag pointers

  initialize(): Promise<void>;
  close(): Promise<void>;
}
```

### Workspace - Mutable Local State

The workspace layer manages checkout state:

- **Staging**: Index/staging area with conflict handling
- **Checkout**: HEAD management and operation state
- **Worktree**: Working directory file access
- **WorkingCopy**: Unified interface linking all three

### TransformationStore - Operation State

For multi-commit operations (merge, rebase, cherry-pick, revert):

```typescript
interface TransformationStore {
  readonly merge: MergeStateStore;
  readonly rebase: RebaseStateStore;
  readonly cherryPick: CherryPickStateStore;
  readonly revert: RevertStateStore;
  readonly resolution?: ResolutionStore;  // Conflict management with rerere
}
```

## Example Applications

The `apps/` directory contains several examples. See [docs/example-applications.md](docs/example-applications.md) for detailed documentation.

| Application | Description |
|-------------|-------------|
| [example-readme-scripts](apps/example-readme-scripts) | Runnable versions of all README code examples |
| [example-git-cycle](apps/example-git-cycle) | Complete Git workflow demonstration |
| [example-git-lifecycle](apps/example-git-lifecycle) | Full Git lifecycle: init, commits, GC, packing, checkout |
| [example-git-perf](apps/example-git-perf) | Performance benchmarks with real repositories |
| [example-git-push](apps/example-git-push) | Push operations demonstration |
| [example-vcs-http-roundtrip](apps/example-vcs-http-roundtrip) | Full HTTP clone/push workflow using VCS |
| [example-pack-gc](apps/example-pack-gc) | Pack file garbage collection |
| [examples-git](apps/examples-git) | Various Git format examples |
| [perf-bench](apps/perf-bench) | Micro-benchmarks |

Run any example:

```bash
pnpm --filter @statewalker/vcs-example-git-cycle start
```

## Development

```bash
# Build a specific package
pnpm --filter @statewalker/vcs-core build

# Run tests for a specific package
pnpm --filter @statewalker/vcs-core test

# Lint and format
pnpm lint
pnpm format
```

The project uses:
- **pnpm** for package management with workspaces
- **Turborepo** for build orchestration
- **Rolldown** for bundling
- **Vitest** for testing
- **Biome** for linting and formatting

## Requirements

- Node.js 18 or later
- pnpm 9.15.0 or later

## License

MIT
