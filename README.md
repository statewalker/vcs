# WebRun VCS

A TypeScript implementation of Git-compatible version control, designed for content-addressable storage with delta compression. This library enables reading and writing Git repositories directly in JavaScript environments, including browsers.

## Goal

WebRun VCS provides a portable, streaming-oriented implementation of Git's core object model. It allows applications to work with Git repositories without relying on native Git binaries or specific file system APIs.

The library focuses on three main capabilities:

**Content-Addressable Storage** - Store and retrieve objects by their SHA-1 hash. Identical content automatically deduplicates, making storage efficient for version control workloads.

**Delta Compression** - Reduce storage requirements by computing and storing differences between similar objects. The implementation supports multiple delta strategies including rsync-style rolling checksums and Myers diff algorithm.

**Git Compatibility** - Read and write standard Git pack files, loose objects, and refs. Repositories created with WebRun VCS work with native Git tools and vice versa.

## Package Structure

The monorepo contains five packages organized by responsibility:

### Core Packages

**[@webrun-vcs/utils](packages/utils)** provides foundational algorithms. This includes zlib compression/decompression, SHA-1 hashing with streaming support, and diff algorithms for computing deltas between binary content.

**[@webrun-vcs/vcs](packages/vcs)** defines the core interfaces and provides base implementations. The interfaces establish contracts for object storage, tree management, commits, refs, and tags. Base implementations handle delta compression, memory-based storage, and pack file reading.

### Storage Adapters

**[@webrun-vcs/store-files](packages/store-files)** implements Git-compatible file storage. It reads and writes the standard `.git` directory structure including loose objects, pack files, and refs. This adapter works with any file system API that implements the required interface.

**[@webrun-vcs/store-sql](packages/store-sql)** provides SQL-based storage using better-sqlite3. Objects, refs, and metadata persist in SQLite tables, making it suitable for server environments or applications preferring relational storage.

### Development Utilities

**[@webrun-vcs/testing](packages/testing)** contains shared test utilities and fixtures used across packages.

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
import { createGitStorage } from "@webrun-vcs/store-files";

// Initialize an in-memory repository
const files = new FilesApi(new MemFilesApi());
const storage = await createGitStorage(files, "/repo/.git", {
  create: true,
  defaultBranch: "main"
});

// Store a file as a blob
const content = new TextEncoder().encode("Hello, World!");
const blobId = await storage.objects.store([content]);

// Create a tree (directory snapshot)
const treeId = await storage.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId }
]);

// Create a commit
const commitId = await storage.commits.storeCommit({
  tree: treeId,
  parents: [],
  author: { name: "Alice", email: "alice@example.com", timestamp: Date.now() / 1000, tzOffset: "+0000" },
  committer: { name: "Alice", email: "alice@example.com", timestamp: Date.now() / 1000, tzOffset: "+0000" },
  message: "Initial commit"
});

// Update the branch reference
await storage.refs.setRef("refs/heads/main", commitId);
```

### Working with Pack Files

For performance benchmarks and pack file operations, see [apps/example-git-perf](apps/example-git-perf). This example clones the Git source repository and demonstrates traversing commit history and reading delta-compressed objects.

## Example Applications

The `apps/` directory contains several examples:

| Application | Description |
|-------------|-------------|
| [example-git-cycle](apps/example-git-cycle) | Complete Git workflow demonstration |
| [example-git-perf](apps/example-git-perf) | Performance benchmarks with real repositories |
| [example-pack-gc](apps/example-pack-gc) | Pack file garbage collection |
| [examples-git](apps/examples-git) | Various Git format examples |
| [perf-bench](apps/perf-bench) | Micro-benchmarks |

Run any example:

```bash
pnpm --filter @webrun-vcs/example-git-cycle start
```

## Development

```bash
# Build a specific package
pnpm --filter @webrun-vcs/vcs build

# Run tests for a specific package
pnpm --filter @webrun-vcs/store-files test

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
