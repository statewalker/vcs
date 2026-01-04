# @statewalker/vcs-testing

Parametrized test suites for validating storage backend implementations.

## Overview

This internal package provides test suites that validate storage implementations against interface contracts. When you build a new storage backend, run these suites against it to ensure your implementation behaves correctly. The same tests run against store-mem, store-kv, store-sql, and store-files, guaranteeing consistent behavior across all backends.

The suites test interface compliance, not implementation details. They verify that storing an object and retrieving it returns identical content, that references update atomically, that staging entries persist correctly, and dozens of other behavioral requirements. If your implementation passes all suites, it will work correctly with the rest of the webrun-vcs ecosystem.

This is a private package, intended only for development within the webrun-vcs monorepo. It's not published to npm.

## Installation

This package is private and available only within the webrun-vcs monorepo:

```json
{
  "devDependencies": {
    "@statewalker/vcs-testing": "workspace:*"
  }
}
```

## Public API

### Test Suites

| Suite | Tests |
|-------|-------|
| `objectStorageSuite` | ObjectStore interface compliance |
| `deltaObjectStorageSuite` | DeltaObjectStore interface |
| `objectRepositorySuite` | ObjectRepository interface |
| `deltaRepositorySuite` | DeltaRepository interface |
| `metadataRepositorySuite` | MetadataRepository interface |
| `commitStoreSuite` | CommitStore interface |
| `refStoreSuite` | RefStore interface |
| `stagingStoreSuite` | StagingStore interface |
| `tagStoreSuite` | TagStore interface |
| `treeStoreSuite` | TreeStore interface |

### Test Utilities

```typescript
import { createTestContent, collectAsync, toAsyncIterable } from "@statewalker/vcs-testing";
```

## Usage Examples

### Running Suites Against Your Implementation

Each suite accepts a factory function that creates a fresh instance:

```typescript
import { describe } from "vitest";
import { objectStorageSuite } from "@statewalker/vcs-testing";
import { MyCustomObjectStore } from "./my-store";

describe("MyCustomObjectStore", () => {
  objectStorageSuite({
    createStore: () => new MyCustomObjectStore(),
    // Optional cleanup
    cleanup: async (store) => {
      await store.close();
    },
  });
});
```

### Testing Multiple Interfaces

Most backends implement multiple interfaces. Test each one:

```typescript
import { describe } from "vitest";
import {
  objectStorageSuite,
  refStoreSuite,
  commitStoreSuite,
} from "@statewalker/vcs-testing";
import { createMyStorage } from "./my-storage";

describe("MyStorage", () => {
  let storage;

  beforeEach(() => {
    storage = createMyStorage();
  });

  afterEach(async () => {
    await storage.close();
  });

  describe("ObjectStore", () => {
    objectStorageSuite({
      createStore: () => storage.objectStore,
    });
  });

  describe("RefStore", () => {
    refStoreSuite({
      createStore: () => storage.refStore,
    });
  });

  describe("CommitStore", () => {
    commitStoreSuite({
      createStore: () => storage.commitStore,
    });
  });
});
```

### Using Test Utilities

Helper functions simplify test data creation:

```typescript
import { createTestContent, collectAsync, toAsyncIterable } from "@statewalker/vcs-testing";

// Create test content of specific size
const content = createTestContent(1024); // 1KB of deterministic content

// Convert sync iterable to async
async function* chunks() {
  yield new Uint8Array([1, 2, 3]);
}
const hash = await store.store(chunks());

// Collect async iterable into single Uint8Array
const retrieved = await collectAsync(store.load(hash));
```

### What the Suites Test

The `objectStorageSuite` verifies behaviors like:

```typescript
// Store and retrieve returns identical content
const hash = await store.store(content);
const retrieved = await store.load(hash);
expect(retrieved).toEqual(content);

// Same content produces same hash
const hash1 = await store.store(content);
const hash2 = await store.store(content);
expect(hash1).toBe(hash2);

// Non-existent objects throw or return undefined appropriately
await expect(store.load("nonexistent")).rejects.toThrow();

// exists() returns correct values
expect(await store.exists(hash)).toBe(true);
expect(await store.exists("nonexistent")).toBe(false);
```

## Architecture

### Design Decisions

Parametrized testing ensures all backends share the same behavioral contract. Rather than copy-paste tests across packages, each backend imports and runs the same suites. This approach catches inconsistencies early and documents expected behavior through executable specifications.

The suites test observable behavior, not internal implementation. They don't care whether your backend uses SQLite, files, or carrier pigeons—only that it stores and retrieves data correctly.

### Implementation Details

Each suite uses Vitest's `describe` and `it` blocks, organized by operation type. Setup and teardown hooks call the provided factory and cleanup functions, ensuring test isolation.

The suites avoid implementation-specific assertions. Instead of checking internal data structures, they verify through the public interface: store content, retrieve it, compare results.

## JGit References

While JGit doesn't have an exact equivalent, the concept maps to:

| webrun-vcs | JGit Equivalent |
|------------|-----------------|
| Interface test suites | JGit's test infrastructure for storage implementations |
| Parametrized testing | Tests run against FileRepository, DfsRepository, etc. |

The approach mirrors how JGit tests its DFS implementations, ensuring all backends (in-memory, cloud storage) behave identically.

## Dependencies

**Runtime:**
- `@statewalker/vcs-core` - Interface definitions

**Peer Dependencies:**
- `vitest` - Test framework

**Development:**
- `rolldown` - Bundling
- `typescript` - Type definitions

## License

MIT
