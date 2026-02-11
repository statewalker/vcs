# 10-custom-storage

Build History instances using different factory patterns, from zero-config convenience functions to fully custom store composition. This example walks through each creation pattern so you can pick the right one for your storage needs.

## Quick Start

```bash
# From the monorepo root
pnpm install
pnpm --filter @statewalker/vcs-example-10-custom-storage start
```

## What You'll Learn

- Choose the right factory function for each use case
- Build a History from raw storage components
- Compose a History from explicit store instances
- Share underlying storage between multiple History instances
- Understand the difference between History and HistoryWithOperations

## Prerequisites

- Node.js 18+
- pnpm
- Completed [01-quick-start](../01-quick-start/)

---

## Step-by-Step Guide

**File:** [src/main.ts](src/main.ts)

### Pattern 1: Quick In-Memory History

The fastest way to get a working repository. `createMemoryHistory()` wires up all stores internally and returns a basic `History` interface -- ideal for unit tests and quick prototypes.

```typescript
import { createMemoryHistory, type History } from "@statewalker/vcs-core";

const history: History = createMemoryHistory();
await history.initialize();
await history.refs.setSymbolic("HEAD", "refs/heads/main");

// Use history.blobs, .trees, .commits, .tags, .refs
```

**Key APIs:**
- `createMemoryHistory()` - Zero-config in-memory History factory
- `History` - Base interface exposing blobs, trees, commits, tags, refs

---

### Pattern 2: In-Memory History with Operations

When you need delta compression, serialization, or transport capabilities on top of the basic stores, use `createMemoryHistoryWithOperations()`. It returns the extended `HistoryWithOperations` interface.

```typescript
import {
  createMemoryHistoryWithOperations,
  type HistoryWithOperations,
} from "@statewalker/vcs-core";

const history: HistoryWithOperations = createMemoryHistoryWithOperations();
await history.initialize();

// Additional APIs: history.delta, history.serialization, history.capabilities
const reachable = history.collectReachableObjects(new Set([commitId]), new Set());
```

**Key APIs:**
- `createMemoryHistoryWithOperations()` - In-memory factory with delta/serialization support
- `HistoryWithOperations` - Extended interface adding `delta`, `serialization`, `capabilities`
- `collectReachableObjects()` - Walk the object graph from a set of commit roots

---

### Pattern 3: History from Raw Components

`createHistoryFromComponents()` lets you supply your own raw storage layers. Blobs go into one `RawStorage` instance while trees, commits, and tags go through a `GitObjectStore`. This separation enables different storage strategies for content vs. metadata.

```typescript
import {
  createHistoryFromComponents,
  createGitObjectStore,
  MemoryRawStorage,
} from "@statewalker/vcs-core";

const blobStorage = new MemoryRawStorage();
const objects = createGitObjectStore(new MemoryRawStorage());

const history = createHistoryFromComponents({
  blobStorage,
  objects,
  refs: { type: "memory" },
});
await history.initialize();
```

**Key APIs:**
- `createHistoryFromComponents()` - Build History from raw storage + object store
- `MemoryRawStorage` - In-memory implementation of `RawStorage`
- `createGitObjectStore()` - Wrap a `RawStorage` as a typed Git object store

---

### Pattern 4: History from Explicit Stores

For maximum flexibility, construct each store yourself and hand them to `createHistoryFromStores()`. This is the pattern you would use when wrapping external databases (SQL, IndexedDB, or a cloud backend) behind the store interfaces.

```typescript
import {
  createHistoryFromStores,
  createBlobs, createTrees, createCommits, createTags,
  createMemoryRefs, createGitObjectStore, MemoryRawStorage,
} from "@statewalker/vcs-core";

const objects = createGitObjectStore(new MemoryRawStorage());

const history = createHistoryFromStores({
  blobs: createBlobs(new MemoryRawStorage()),
  trees: createTrees(objects),
  commits: createCommits(objects),
  tags: createTags(objects),
  refs: createMemoryRefs(),
});
await history.initialize();
```

**Key APIs:**
- `createHistoryFromStores()` - Compose History from fully-constructed store instances
- `createBlobs()`, `createTrees()`, `createCommits()`, `createTags()` - Individual store factories
- `createMemoryRefs()` - In-memory ref store factory

---

### Pattern 5: Shared Storage Between Instances

Multiple History instances can share the same underlying blob and object storage while maintaining independent refs. Objects written by one workspace are immediately visible to the other, but each workspace tracks its own branches.

```typescript
const sharedBlobStorage = new MemoryRawStorage();
const sharedObjects = createGitObjectStore(new MemoryRawStorage());

const workspaceA = createHistoryFromComponents({
  blobStorage: sharedBlobStorage,
  objects: sharedObjects,
  refs: { type: "memory" }, // separate refs
});

const workspaceB = createHistoryFromComponents({
  blobStorage: sharedBlobStorage,
  objects: sharedObjects,
  refs: { type: "memory" }, // separate refs
});

// Objects written by A are visible to B
// Refs are independent per workspace
```

**Key APIs:**
- `createHistoryFromComponents()` - Accepts shared storage instances
- `MemoryRawStorage` - Shared across History instances for object deduplication

---

## Key Concepts

### Factory Function Decision Guide

Each factory targets a different level of customization. `createMemoryHistory()` is the quickest path to a working repository -- it allocates all storage internally and returns a basic `History`. When your tests need pack generation or delta compression, switch to `createMemoryHistoryWithOperations()` for the extended `HistoryWithOperations` interface.

For custom backends, `createHistoryFromComponents()` lets you supply raw storage layers (a `RawStorage` for blobs and a `GitObjectStore` for structured objects) while the factory wires up the typed stores. If you need full control -- say, wrapping IndexedDB or a SQL database -- use `createHistoryFromStores()` and construct each store yourself.

For production Git-compatible filesystem storage, `createGitFilesHistory()` (from `@statewalker/vcs-store-fs`) provides pre-built stores backed by the real filesystem.

### Shared Storage

Sharing the same `MemoryRawStorage` and `GitObjectStore` across multiple History instances gives you a lightweight multi-workspace model. All object data is deduplicated in one place, while each workspace maintains its own ref namespace. This pattern is useful for multi-workspace setups, testing isolation scenarios, and read-replica architectures where several consumers need to read the same objects independently.

---

## Project Structure

```
apps/examples/10-custom-storage/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    └── main.ts           # All five factory patterns in one file
```

---

## Output Example

```
=== Pattern 1: createMemoryHistory() ===

  Best for: unit tests, quick prototypes, in-memory operations
  Returns: History (basic interface)

  Commit: a1b2c3d
  Available APIs: blobs, trees, commits, tags, refs

=== Pattern 2: createMemoryHistoryWithOperations() ===

  Best for: tests needing delta/serialization, transport testing
  Returns: HistoryWithOperations (extended interface)

  Commit: e4f5a6b
  Additional APIs: delta, serialization, capabilities
  Capabilities: {"ofs_delta":true,"side_band_64k":true}
  Reachable objects from commit: 3

=== Pattern 3: createHistoryFromComponents() ===

  Best for: custom storage layers, shared storage between instances
  Returns: History (basic interface)

  Commit: c7d8e9f
  blobStorage and objectStorage are separate MemoryRawStorage instances
  This separation enables different storage strategies for blobs vs metadata

=== Pattern 4: createHistoryFromStores() ===

  Best for: fully custom stores, wrapping external databases
  Returns: History (basic interface)

  Commit: f0a1b2c
  Each store (blobs, trees, commits, tags, refs) is independently constructed
  Store instances can wrap any backing storage (memory, SQL, IndexedDB, etc.)

=== Pattern 5: Shared Storage ===

  Best for: multi-workspace, testing isolation, read replicas
  Pattern: Multiple History instances sharing the same raw storage

  Workspace A wrote commit: d3e4f5a
  Workspace B can read it: "Shared commit"
  Workspace A refs/heads/feature: not set
  Workspace B refs/heads/feature: d3e4f5a

=== Decision Guide ===

  createMemoryHistory()
    -> Quick testing, no delta/serialization needed

  createMemoryHistoryWithOperations()
    -> Testing with transport/pack/delta operations

  createHistoryFromComponents({ blobStorage, objects, refs })
    -> Custom storage layer, shared storage between instances

  createHistoryFromStores({ blobs, trees, commits, tags, refs })
    -> Fully custom store implementations (SQL, IndexedDB, etc.)

  createGitFilesHistory(config)
    -> Production Git-compatible filesystem storage

Example completed successfully!
```

---

## API Reference Links

| Function / Class | Location | Purpose |
|------------------|----------|---------|
| `createMemoryHistory()` | [history/create-history.ts](../../../packages/core/src/history/create-history.ts) | Zero-config in-memory History |
| `createMemoryHistoryWithOperations()` | [history/create-history.ts](../../../packages/core/src/history/create-history.ts) | In-memory History with delta/serialization |
| `createHistoryFromComponents()` | [history/create-history.ts](../../../packages/core/src/history/create-history.ts) | Build History from raw storage layers |
| `createHistoryFromStores()` | [history/create-history.ts](../../../packages/core/src/history/create-history.ts) | Build History from explicit store instances |
| `createGitObjectStore()` | [history/objects/index.ts](../../../packages/core/src/history/objects/index.ts) | Wrap RawStorage as Git object store |
| `MemoryRawStorage` | [storage/raw/memory-raw-storage.ts](../../../packages/core/src/storage/raw/memory-raw-storage.ts) | In-memory RawStorage implementation |
| `createBlobs()` | [history/blobs/blobs.impl.ts](../../../packages/core/src/history/blobs/blobs.impl.ts) | Blob store factory |
| `createTrees()` | [history/trees/trees.impl.ts](../../../packages/core/src/history/trees/trees.impl.ts) | Tree store factory |
| `createCommits()` | [history/commits/commits.impl.ts](../../../packages/core/src/history/commits/commits.impl.ts) | Commit store factory |
| `createTags()` | [history/tags/tags.impl.ts](../../../packages/core/src/history/tags/tags.impl.ts) | Tag store factory |
| `createMemoryRefs()` | [history/refs/refs.impl.ts](../../../packages/core/src/history/refs/refs.impl.ts) | In-memory ref store factory |

---

## Next Steps

- [01-quick-start](../01-quick-start/) - Fundamental Git workflow with the low-level API
- [06-internal-storage](../06-internal-storage/) - Deep dive into the storage layer internals
- [11-delta-strategies](../11-delta-strategies/) - Storage optimization with delta compression
