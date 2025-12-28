# Example Applications

This document describes the example applications included in the WebRun VCS monorepo. Each example demonstrates different aspects of the VCS library, from basic Git operations to advanced pack file handling and remote transport.

## Quick Reference

| Application | Purpose | Key Features |
|------------|---------|--------------|
| [example-git-cycle](#example-git-cycle) | Complete Git workflow tutorial | Blobs, trees, commits, branches, history |
| [example-git-lifecycle](#example-git-lifecycle) | Full repository lifecycle | Init, commits, GC, packing, checkout |
| [example-git-perf](#example-git-perf) | Performance benchmarking | Real-world repository, timing metrics |
| [example-git-push](#example-git-push) | Push operations | Branch creation, commits, VCS transport |
| [example-pack-gc](#example-pack-gc) | Pack file and GC | Loose objects, packing, native git verification |
| [example-vcs-http-roundtrip](#example-vcs-http-roundtrip) | HTTP transport | Custom VCS server, clone, push |
| [examples-git](#examples-git) | Pack file format | Read/write pack files, delta compression |
| [perf-bench](#perf-bench) | Micro-benchmarks | SHA-1, compression, delta algorithms |

## example-git-cycle

**Location:** [apps/example-git-cycle](../apps/example-git-cycle)

The primary tutorial for learning WebRun VCS. This example walks through the complete Git workflow step-by-step, teaching the fundamentals of content-addressable storage and version control.

### What You Learn

The example progresses through 8 steps, each demonstrating core concepts:

1. **Initialize Repository** - Create a Git repository with standard `.git` structure
2. **Create Files (Blobs)** - Store file content as content-addressed objects
3. **Build Trees** - Create directory snapshots with file modes
4. **Create Commits** - Link tree snapshots to history with metadata
5. **Update Files** - Add, modify, and remove files between commits
6. **View History** - Traverse commit ancestry and query history
7. **Restore Versions** - Access files from any point in history
8. **Branches and Tags** - Manage references for parallel development

### Running

```bash
# Run all steps
pnpm --filter @webrun-vcs/example-git-cycle start

# Run individual step
pnpm --filter @webrun-vcs/example-git-cycle step:01
```

### Key APIs

- `createGitRepository()` - Repository factory
- `repository.blobs.store()` - Store file content
- `repository.trees.storeTree()` - Create directory structure
- `repository.commits.storeCommit()` - Create commits
- `repository.refs.set()` - Update references

---

## example-git-lifecycle

**Location:** [apps/example-git-lifecycle](../apps/example-git-lifecycle)

Demonstrates the complete lifecycle of a Git repository from creation through garbage collection and checkout verification. This example validates that repositories created with VCS are fully compatible with native Git.

### Workflow Steps

1. **Initialize Repository** - Create repository using FilesApi
2. **Create Initial Files** - Add 8 files in multiple directories
3. **Generate 20 Commits** - Create incremental changes over time
4. **Verify Loose Objects** - Confirm objects stored in `.git/objects`
5. **Run Garbage Collection** - Execute native `git gc`
6. **Verify Packed Objects** - Check pack file integrity with `git verify-pack`
7. **Verify Native Git** - Run `git fsck`, `git log`, etc.
8. **Checkout First Version** - Restore initial commit state
9. **Verify Checkout** - Confirm files match original content

### Key Validation

The example proves VCS compatibility by using native Git for verification:
- Pack file integrity verified with `git verify-pack`
- Repository structure verified with `git fsck`
- Commit history readable with standard Git tools
- Checkout produces identical file content

### Running

```bash
pnpm --filter @webrun-vcs/example-git-lifecycle start
```

---

## example-git-perf

**Location:** [apps/example-git-perf](../apps/example-git-perf)

Performance benchmark using the official Git source repository. Measures real-world performance of pack file reading, commit traversal, and object access.

### Benchmark Workflow

1. **Clone Git Repository** - Downloads official Git source from GitHub
2. **Run Garbage Collection** - Optimize pack files with `git gc --aggressive`
3. **Load Pack Files** - Initialize VCS storage and indexes
4. **Traverse Commits** - Walk last 1000 commits with full parsing
5. **Measure Object Access** - Random access to commits and trees
6. **Output Results** - Write metrics to `performance-results.json`
7. **Checkout Verification** - Extract files using VCS, verify with native Git

### Performance Metrics

- **webrun_vcs_init** - Time to initialize storage and load pack indexes
- **commit_traversal** - Time to walk 1000 commits with full parsing
- **object_random_access** - Time for random object lookups

### Running

```bash
# Full benchmark (first run clones ~200MB repository)
pnpm --filter @webrun-vcs/example-git-perf start

# Individual steps
pnpm --filter @webrun-vcs/example-git-perf step:clone
pnpm --filter @webrun-vcs/example-git-perf step:traverse
```

### Requirements

- Internet connection (for initial clone)
- ~500MB disk space
- Git command-line tools

---

## example-git-push

**Location:** [apps/example-git-push](../apps/example-git-push)

Demonstrates branch creation, commits, and push operations using VCS transport to communicate with a native Git HTTP server.

### Workflow

1. **Setup Remote** - Create bare repository with initial commit
2. **Start HTTP Server** - Launch native Git HTTP server
3. **Clone Repository** - Clone using native Git
4. **Open with VCS** - Load repository using `createGitRepository()`
5. **Create Branch** - Create branch using `repository.refs.set()`
6. **Make Commit** - Store blob, tree, and commit
7. **Push Changes** - Push using VCS transport
8. **Verify** - Confirm push with native Git

### Key Patterns

Creating commits with typed stores:
```typescript
const blobId = await repository.blobs.store([content]);
const treeId = await repository.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "file.txt", id: blobId },
]);
const commitId = await repository.commits.storeCommit({
  tree: treeId,
  parents: [parentId],
  author, committer, message,
});
```

Pushing with VCS transport:
```typescript
import { push } from "@webrun-vcs/transport";
await push({ url, refspecs, getLocalRef, getObjectsToPush });
```

### Running

```bash
pnpm --filter @webrun-vcs/example-git-push start
```

---

## example-pack-gc

**Location:** [apps/example-pack-gc](../apps/example-pack-gc)

Demonstrates pack file creation and garbage collection, proving compatibility with native Git.

### Workflow

1. **Create Repository** - Initialize on real filesystem using `NodeFilesApi`
2. **Create 4 Commits** - Progressive changes to README, source, package.json
3. **Verify Loose Objects** - Confirm 12 loose objects in `.git/objects`
4. **Pack Objects (GC)** - Consolidate into pack file with delta compression
5. **Verify Cleanup** - Confirm loose objects removed after packing
6. **Verify Commits** - Load all commits from pack file
7. **Native Git Verification** - Run `git log`, `git show`, `git fsck`, `git reset`

### Key APIs

- `storage.rawStorage.repack()` - Pack objects and prune loose objects
- `storage.rawStorage.pruneLooseObjects()` - Manual loose object cleanup
- `storage.refresh()` - Reload pack files after changes

### Running

```bash
pnpm --filter @webrun-vcs/example-pack-gc start
```

---

## example-vcs-http-roundtrip

**Location:** [apps/example-vcs-http-roundtrip](../apps/example-vcs-http-roundtrip)

Complete HTTP workflow using VCS for both server and client. Proves the library can handle the full Git HTTP smart protocol without native Git binaries.

### Architecture

**VCS HTTP Server** implements Git smart protocol endpoints:
- `/info/refs?service=git-upload-pack` - Ref discovery for clone/fetch
- `/git-upload-pack` - Send pack data to client
- `/info/refs?service=git-receive-pack` - Ref discovery for push
- `/git-receive-pack` - Receive pack data from client

### Workflow

1. **Create Remote** - Initialize bare repository with VCS
2. **Start VCS Server** - Launch custom HTTP server
3. **Clone** - Clone using VCS transport (no `git clone`)
4. **Verify Clone** - Use native Git for integrity check
5. **Modify Content** - Create new blobs and trees with VCS
6. **Create Branch** - Create branch and commit
7. **Push** - Push using VCS transport (no `git push`)
8. **Verify Push** - Confirm with native Git

### Protocol Features

- Sideband multiplexing (pack data, progress, errors)
- Delta object resolution (OFS_DELTA, REF_DELTA)
- Pack file generation for clone/fetch
- Pack file parsing and storage for push

### Running

```bash
pnpm --filter @webrun-vcs/example-vcs-http-roundtrip start
```

---

## examples-git

**Location:** [apps/examples-git](../apps/examples-git)

Technical examples demonstrating pack file format handling. Shows low-level pack reading, writing, and delta preservation.

### Examples

| # | Name | Description |
|---|------|-------------|
| 1 | Simple Roundtrip | Read all objects, write back to new pack |
| 2 | Delta Preservation | Analyze delta relationships and dependencies |
| 3 | Streaming OFS_DELTA | Incremental pack building with offset deltas |
| 4 | Full Verification | Byte-level comparison of pack contents |
| 5 | Index Format Comparison | Compare V1 vs V2 index formats |

### Key APIs

Reading packs:
```typescript
import { readPackIndex, PackReader } from "@webrun-vcs/core";
const index = readPackIndex(idxData);
const reader = new PackReader(files, "pack.pack", index);
const obj = await reader.get(objectId);
```

Writing packs:
```typescript
import { writePack, writePackIndexV2 } from "@webrun-vcs/core";
const result = await writePack(objects);
const idxData = await writePackIndexV2(result.indexEntries, result.packChecksum);
```

### Running

```bash
# Generate test data
./test-data/create-test-pack.sh ./test-data

# Run all examples
pnpm --filter @webrun-vcs/examples-git examples ./test-data/git-repo/test.pack

# Run specific example
pnpm --filter @webrun-vcs/examples-git example:01 ./test-data/git-repo/test.pack
```

---

## perf-bench

**Location:** [apps/perf-bench](../apps/perf-bench)

Micro-benchmarks for core algorithms. Measures performance of foundational operations in isolation.

### Benchmarks

- **SHA-1 Hashing** - Content hashing performance
- **Compression** - Zlib compress/decompress throughput
- **Delta Creation** - Delta encoding for similar content
- **Delta Application** - Delta decoding and reconstruction

### Running

```bash
pnpm --filter perf-bench start
```

---

## Common Patterns

All examples share common patterns for working with VCS:

### Opening Repositories

```typescript
import { createGitRepository } from "@webrun-vcs/core";
import { FilesApi, NodeFilesApi } from "@statewalker/webrun-files";

const files = new FilesApi(new NodeFilesApi({ fs, rootDir: "./repo" }));
const repository = await createGitRepository(files, ".git");
```

### Storing Content

```typescript
// Store blob
const blobId = await repository.blobs.store([content]);

// Create tree
const treeId = await repository.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "file.txt", id: blobId },
]);

// Create commit
const commitId = await repository.commits.storeCommit({
  tree: treeId,
  parents: [parentId],
  author, committer, message,
});

// Update reference
await repository.refs.set("refs/heads/main", commitId);
```

### Native Git Verification

Examples use native Git to verify VCS compatibility:

```bash
git fsck                    # Verify integrity
git log                     # View history
git cat-file -p <id>        # Read objects
git verify-pack -v *.pack   # Verify pack files
git diff-index --quiet HEAD # Verify checkout
```

## Related Documentation

- [Package Dependencies](package-dependencies.md) - Package relationship diagram
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture overview
- [README.md](../README.md) - Getting started guide
