# @webrun-vcs/store-kv

Key-value storage abstraction with adapters for various backends.

## Overview

This package bridges webrun-vcs storage interfaces to key-value stores. Whether you're targeting IndexedDB in browsers, LocalStorage for simple persistence, or LevelDB for Node.js applications, the KV abstraction lets you use the same VCS code across all these backends.

The adapter pattern separates VCS logic from storage mechanics. You implement a simple `KVStore` interface for your target backend, then the provided store classes handle Git-specific concerns like serialization, key namespacing, and data organization. This separation keeps adapters small and focused.

The package includes a `MemoryAdapter` for testing, demonstrating the minimal interface adapters must implement. Use it as a reference when building adapters for IndexedDB, LocalStorage, or other key-value systems.

## Installation

```bash
pnpm add @webrun-vcs/store-kv
```

## Public API

### KV Store Interface

The foundation that all adapters implement:

```typescript
import type { KVStore } from "@webrun-vcs/store-kv";

interface KVStore {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  keys(prefix?: string): AsyncIterable<string>;
}
```

### Exports

| Export | Description |
|--------|-------------|
| `KVStore` | Key-value store interface |
| `MemoryAdapter` | In-memory KV adapter (for testing) |
| `KVCommitStore` | Commit store using KV backend |
| `KVRefStore` | Reference store using KV backend |
| `KVStagingStore` | Staging store using KV backend |
| `KVTagStore` | Tag store using KV backend |
| `KVTreeStore` | Tree store using KV backend |

## Usage Examples

### Using the Memory Adapter

For testing and development:

```typescript
import { MemoryAdapter, KVCommitStore, KVRefStore } from "@webrun-vcs/store-kv";

const kv = new MemoryAdapter();
const commitStore = new KVCommitStore(kv);
const refStore = new KVRefStore(kv);

// Use stores normally
await refStore.setRef("refs/heads/main", commitHash);
```

### Creating an IndexedDB Adapter

Here's how to implement a browser-compatible adapter:

```typescript
import type { KVStore } from "@webrun-vcs/store-kv";

class IndexedDBAdapter implements KVStore {
  private db: IDBDatabase;
  private storeName: string;

  constructor(db: IDBDatabase, storeName = "vcs-objects") {
    this.db = db;
    this.storeName = storeName;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== undefined;
  }

  async *keys(prefix?: string): AsyncIterable<string> {
    // Implementation depends on IndexedDB cursor usage
    const allKeys = await this.getAllKeys();
    for (const key of allKeys) {
      if (!prefix || key.startsWith(prefix)) {
        yield key;
      }
    }
  }

  private getAllKeys(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.getAllKeys();

      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  }
}
```

### Wiring Up a Complete Repository

```typescript
import {
  MemoryAdapter,
  KVCommitStore,
  KVRefStore,
  KVStagingStore,
  KVTagStore,
  KVTreeStore,
} from "@webrun-vcs/store-kv";

function createKVStorage(adapter: KVStore) {
  return {
    commitStore: new KVCommitStore(adapter),
    refStore: new KVRefStore(adapter),
    stagingStore: new KVStagingStore(adapter),
    tagStore: new KVTagStore(adapter),
    treeStore: new KVTreeStore(adapter),
  };
}

// Usage
const adapter = new MemoryAdapter();
const storage = createKVStorage(adapter);
```

## Architecture

### Design Decisions

The adapter pattern was chosen for maximum flexibility. Key-value stores vary significantly in their APIs (sync vs async, transaction support, iteration methods), but they share the same fundamental operations. The `KVStore` interface captures this common ground.

Stores use prefix-based namespacing to isolate different data types within a single KV backend. Commits might use `commits/` prefix, refs use `refs/`, and so on. This approach works well with KV stores that support prefix scanning.

### Implementation Details

All KV stores serialize data to `Uint8Array` for storage. This binary format avoids encoding issues and works consistently across all adapter implementations. The stores handle serialization of higher-level structures (commits, trees, refs) internally.

The async-first API accommodates both synchronous backends (like in-memory Maps) and inherently asynchronous ones (like IndexedDB). Synchronous adapters simply return resolved promises.

## JGit References

JGit doesn't have a direct equivalent to key-value storage abstraction. The closest comparison is the DFS (Distributed File System) layer:

| webrun-vcs | JGit Equivalent |
|------------|-----------------|
| `KVStore` interface | `org.eclipse.jgit.internal.storage.dfs.DfsObjDatabase` |
| Adapter pattern | DFS backend implementations |

The DFS layer in JGit abstracts storage backends for distributed systems like cloud storage, while KV abstraction targets simpler key-value stores commonly used in browsers and embedded scenarios.

## Dependencies

**Runtime:**
- `@webrun-vcs/vcs` - Interface definitions

**Development:**
- `@webrun-vcs/testing` - Test suites for validation
- `vitest` - Testing
- `rolldown` - Bundling
- `typescript` - Type definitions

## License

MIT
