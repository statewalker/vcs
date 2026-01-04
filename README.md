# WebRun VCS

A TypeScript implementation of Git-compatible version control, designed for content-addressable storage with delta compression. This library enables reading and writing Git repositories directly in JavaScript environments, including browsers.

## Goal

WebRun VCS provides a portable, streaming-oriented implementation of Git's core object model. It allows applications to work with Git repositories without relying on native Git binaries or specific file system APIs.

The library focuses on three main capabilities:

**Content-Addressable Storage** - Store and retrieve objects by their SHA-1 hash. Identical content automatically deduplicates, making storage efficient for version control workloads.

**Delta Compression** - Reduce storage requirements by computing and storing differences between similar objects. The implementation supports multiple delta strategies including rsync-style rolling checksums and Myers diff algorithm.

**Git Compatibility** - Read and write standard Git pack files, loose objects, and refs. Repositories created with WebRun VCS work with native Git tools and vice versa.

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

The example application in [apps/example-git-cycle](apps/example-git-cycle) demonstrates the complete Git workflow. Here's a condensed version:

```typescript
import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import { createGitRepository, FileMode } from "@statewalker/vcs-core";

// Initialize an in-memory repository
const files = new FilesApi(new MemFilesApi());
const repository = await createGitRepository(files, ".git", {
  create: true,
  defaultBranch: "main"
});

// Store a file as a blob
const content = new TextEncoder().encode("Hello, World!");
const blobId = await repository.blobs.store([content]);

// Create a tree (directory snapshot)
const treeId = await repository.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId }
]);

// Create a commit
const commitId = await repository.commits.storeCommit({
  tree: treeId,
  parents: [],
  author: { name: "Alice", email: "alice@example.com", timestamp: Date.now() / 1000, tzOffset: "+0000" },
  committer: { name: "Alice", email: "alice@example.com", timestamp: Date.now() / 1000, tzOffset: "+0000" },
  message: "Initial commit"
});

// Update the branch reference
await repository.refs.set("refs/heads/main", commitId);
```

### Working with Pack Files

For performance benchmarks and pack file operations, see [apps/example-git-perf](apps/example-git-perf). This example clones the Git source repository and demonstrates traversing commit history and reading delta-compressed objects.

### Using the Commands API

For a higher-level API, use `@statewalker/vcs-commands` which provides Git-like commands:

```typescript
import { Git, createGitStore } from "@statewalker/vcs-commands";
import { createGitRepository } from "@statewalker/vcs-core";
import { MemoryStagingStore } from "@statewalker/vcs-store-mem";

// Create repository and staging
const repository = await createGitRepository();
const staging = new MemoryStagingStore();
const store = createGitStore({ repository, staging });
const git = Git.wrap(store);

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

### Delta Compression

The library uses format-agnostic delta storage for efficient pack files:

```typescript
import { createDelta, applyDelta } from "@statewalker/vcs-utils/diff";

const baseContent = new TextEncoder().encode("Original file content");
const newContent = new TextEncoder().encode("Original file content with additions");

// Create a delta from base to new
const delta = createDelta(baseContent, newContent);

// Apply delta to reconstruct new content
const reconstructed = applyDelta(baseContent, delta);
```

## Example Applications

The `apps/` directory contains several examples. See [docs/example-applications.md](docs/example-applications.md) for detailed documentation.

| Application | Description |
|-------------|-------------|
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
