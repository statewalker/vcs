# @webrun-vcs/vcs

Core VCS engine defining storage interfaces and providing delta compression with garbage collection.

## Overview

This package forms the architectural foundation of the webrun-vcs ecosystem. It defines the interfaces that all storage backends must implement, ensuring consistency whether you store objects in memory, SQLite, or Git-compatible files.

Beyond interfaces, the package provides the delta compression engine that dramatically reduces storage requirements for versioned content. When objects share significant portions of their content, the engine stores only the differences. The garbage collection controller identifies unreachable objects and reclaims storage space.

The interface-based design enables flexibility: swap storage backends without changing application code, or combine multiple backends for different use cases (fast in-memory cache backed by persistent SQLite storage, for example).

## Installation

```bash
pnpm add @webrun-vcs/vcs
```

## Public API

### Main Export

```typescript
import {
  // Base implementations
  DefaultObjectStore,
  LRUCache,
  IntermediateCache,
  // Engine
  DeltaStorageManager,
  GCController,
  // All interfaces
  ObjectStore,
  CommitStore,
  RefStore,
  // ...
} from "@webrun-vcs/vcs";
```

### Sub-exports

| Export Path | Description |
|-------------|-------------|
| `@webrun-vcs/vcs/interfaces` | All storage interface definitions |
| `@webrun-vcs/vcs/engine` | DeltaStorageManager, GC controller, pack strategies |

### Key Interfaces

The interfaces package defines the contracts that storage implementations must fulfill:

| Interface | Purpose |
|-----------|---------|
| `ObjectStore` | Content-addressable object storage |
| `CommitStore` | Commit object operations (create, read, parse) |
| `TreeStore` | Tree object operations (directory structures) |
| `TagStore` | Tag object operations (annotated tags) |
| `RefStore` | Reference management (branches, HEAD) |
| `StagingStore` | Staging area operations (index) |
| `DeltaObjectStore` | Delta-compressed object storage |
| `DeltaChainStore` | Delta chain management |
| `DeltaStorageManager` | High-level delta compression orchestration |

### Repository Interfaces

Low-level repository interfaces for backend implementations:

| Interface | Purpose |
|-----------|---------|
| `ObjectRepository` | Raw object CRUD operations |
| `DeltaRepository` | Delta chain storage |
| `MetadataRepository` | Object metadata (type, size, delta info) |

## Usage Examples

### Implementing a Custom Object Store

Storage backends implement the defined interfaces. Here's a simplified example:

```typescript
import type { ObjectStore, StoredObject } from "@webrun-vcs/vcs/interfaces";

class MyObjectStore implements ObjectStore {
  async store(content: AsyncIterable<Uint8Array>): Promise<string> {
    // Collect content, compute SHA-1 hash, persist
    const chunks: Uint8Array[] = [];
    for await (const chunk of content) {
      chunks.push(chunk);
    }
    const fullContent = concat(chunks);
    const hash = computeSha1(fullContent);
    await this.persist(hash, fullContent);
    return hash;
  }

  async *load(hash: string): AsyncIterable<Uint8Array> {
    const content = await this.retrieve(hash);
    yield content;
  }

  async exists(hash: string): Promise<boolean> {
    return this.hasObject(hash);
  }
}
```

### Using Delta Compression

The delta storage manager handles compression automatically:

```typescript
import { DeltaStorageManager } from "@webrun-vcs/vcs/engine";

// Create manager with your storage backends
const deltaManager = new DeltaStorageManager({
  objectRepository,
  deltaRepository,
  metadataRepository,
});

// Store object - manager decides if delta compression is beneficial
const hash = await deltaManager.store(content);

// Load object - transparently reconstructs from delta chain if needed
const data = await deltaManager.load(hash);
```

### Running Garbage Collection

Remove unreachable objects to reclaim storage:

```typescript
import { GCController } from "@webrun-vcs/vcs/engine";

const gc = new GCController({
  objectRepository,
  deltaRepository,
  metadataRepository,
  refStore,
});

// Find all reachable objects starting from refs
const reachable = await gc.findReachableObjects();

// Remove unreachable objects
const stats = await gc.collect();
console.log(`Removed ${stats.deletedObjects} objects`);
```

### Using the LRU Cache

Improve read performance with caching:

```typescript
import { LRUCache } from "@webrun-vcs/vcs/base";

// Cache up to 100 objects
const cache = new LRUCache<string, Uint8Array>(100);

cache.set("abc123", content);
const cached = cache.get("abc123");
```

## Architecture

### Design Decisions

The interface-based architecture separates concerns cleanly: storage backends handle persistence, while the engine handles optimization strategies like delta compression. This separation allows testing each layer independently and swapping implementations freely.

Delta compression uses a strategy pattern, enabling different compression approaches for different scenarios. The default strategy balances compression ratio against CPU cost, but specialized strategies can optimize for specific workloads.

### Implementation Details

The `DefaultObjectStore` provides a reference implementation that wraps repository interfaces with proper content hashing and type handling. Custom backends can extend this class or implement interfaces directly.

The garbage collector uses a mark-and-sweep approach: it traverses the object graph from all refs, marking reachable objects, then deletes unmarked objects. This ensures referential integrity is maintained.

## JGit References

Developers familiar with JGit will recognize these patterns:

| webrun-vcs | JGit |
|------------|------|
| `ObjectStore` | `ObjectDatabase`, `ObjectLoader`, `ObjectInserter` |
| `DeltaStorageManager` | `PackWriter`, `DeltaEncoder`, `DeltaWindow` |
| `RefStore` | `RefDatabase`, `Ref`, `RefUpdate` |
| `GCController` | `GarbageCollectCommand` |
| Delta chains | `DeltaCache`, `DeltaIndex` |
| `ObjectRepository` | Low-level object database operations |

## Dependencies

**Runtime:**
- `@webrun-vcs/utils` - Hashing, compression, delta algorithms

**Development:**
- `vitest` - Testing
- `rolldown` - Bundling
- `typescript` - Type definitions

## License

MIT
