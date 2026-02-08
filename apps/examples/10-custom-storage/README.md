# Example 10: Custom Storage Backends

Building History instances from components using different factory patterns.

## What You'll Learn

- **Factory functions**: When to use each creation pattern
- **Component composition**: Building History from raw storage
- **Store composition**: Providing explicit store instances
- **Shared storage**: Multiple History instances sharing storage
- **History vs HistoryWithOperations**: Choosing the right interface

## Running the Example

```bash
pnpm start
```

## Factory Function Decision Guide

### `createMemoryHistory()`

Quick in-memory storage for testing. No delta or serialization support.

```typescript
const history = createMemoryHistory();
await history.initialize();
// Use history.blobs, .trees, .commits, .tags, .refs
```

### `createMemoryHistoryWithOperations()`

In-memory with delta and serialization APIs. Use for transport testing.

```typescript
const history = createMemoryHistoryWithOperations();
await history.initialize();
// Additional: history.delta, history.serialization, history.capabilities
```

### `createHistoryFromComponents()`

Build from raw storage layers. Useful for custom storage backends.

```typescript
import { MemoryRawStorage, createGitObjectStore } from "@statewalker/vcs-core";

const history = createHistoryFromComponents({
  blobStorage: new MemoryRawStorage(),          // Raw storage for blobs
  objects: createGitObjectStore(new MemoryRawStorage()), // Git objects for trees/commits/tags
  refs: { type: "memory" },                     // Or { type: "adapter", refStore }
});
```

### `createHistoryFromStores()`

Compose from fully-constructed store instances. Maximum flexibility.

```typescript
import {
  createBlobs, createTrees, createCommits, createTags, createMemoryRefs,
  createGitObjectStore, MemoryRawStorage,
} from "@statewalker/vcs-core";

const objects = createGitObjectStore(new MemoryRawStorage());
const history = createHistoryFromStores({
  blobs: createBlobs(new MemoryRawStorage()),
  trees: createTrees(objects),
  commits: createCommits(objects),
  tags: createTags(objects),
  refs: createMemoryRefs(),
});
```

### `createGitFilesHistory(config)`

Production Git-compatible filesystem storage. Requires pre-created stores
from `@statewalker/vcs-store-fs`.

## Key Concept: Shared Storage

Multiple History instances can share the same underlying storage while
maintaining separate refs (branch pointers):

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

## See Also

- [Example 01: Quick Start](../01-quick-start/) - Basic repository operations
- [Example 06: Internal Storage](../06-internal-storage/) - Low-level storage details
- [Example 11: Delta Strategies](../11-delta-strategies/) - Storage optimization
