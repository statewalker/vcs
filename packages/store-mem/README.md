# @statewalker/vcs-store-mem

In-memory storage implementation for testing and development scenarios.

## Overview

This package provides a complete in-memory implementation of all webrun-vcs storage interfaces. Every object, commit, tree, tag, reference, and staging entry lives in JavaScript Maps and Arrays, making this backend perfect for unit tests, development environments, and scenarios where persistence isn't needed.

The in-memory backend is intentionally simple. It focuses on correctness over optimization, serving as a reference implementation that other backends can compare against. The `@statewalker/vcs-testing` package validates all storage backends against the same test suites, ensuring consistent behavior regardless of which backend you choose.

Because everything stays in memory, this backend offers the fastest read and write performance of any storage option. Use it when you need to run thousands of operations in tests without disk I/O overhead.

## Installation

```bash
pnpm add @statewalker/vcs-store-mem
```

## Public API

### Factory Function

The simplest way to create a complete storage setup:

```typescript
import { createMemoryStorage } from "@statewalker/vcs-store-mem";

const storage = createMemoryStorage();
// Returns all stores ready to use
```

### Individual Store Classes

For more control, instantiate stores individually:

| Export | Description |
|--------|-------------|
| `createMemoryStorage()` | Factory creating complete in-memory repository |
| `InMemoryObjectRepository` | Raw object storage |
| `InMemoryDeltaRepository` | Delta chain storage |
| `InMemoryMetadataRepository` | Object metadata storage |
| `InMemoryCommitStore` | Commit operations |
| `InMemoryRefStore` | Reference operations |
| `InMemoryStagingStore` | Staging area |
| `InMemoryTagStore` | Tag operations |
| `InMemoryTreeStore` | Tree operations |

## Usage Examples

### Quick Setup for Testing

The factory function creates everything you need:

```typescript
import { createMemoryStorage } from "@statewalker/vcs-store-mem";

const {
  objectStore,
  commitStore,
  treeStore,
  tagStore,
  refStore,
  stagingStore,
} = createMemoryStorage();

// Now use the stores
const hash = await objectStore.store(async function* () {
  yield new TextEncoder().encode("file content");
}());
```

### Using with @statewalker/vcs-commands

The memory backend integrates seamlessly with high-level commands:

```typescript
import { Git, createGitStore } from "@statewalker/vcs-commands";
import { createGitRepository } from "@statewalker/vcs-core";
import { createMemoryStorage } from "@statewalker/vcs-store-mem";

const { stagingStore } = createMemoryStorage();
const repository = await createGitRepository(); // In-memory by default
const store = createGitStore({ repository, staging: stagingStore });
const git = Git.wrap(store);

// Stage and commit
await git.add().addFilepattern(".").call();
await git.commit().setMessage("Initial commit").call();
```

### Writing Tests

The memory backend makes tests fast and isolated:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStorage } from "@statewalker/vcs-store-mem";

describe("MyFeature", () => {
  let storage;

  beforeEach(() => {
    // Fresh storage for each test
    storage = createMemoryStorage();
  });

  it("should store and retrieve objects", async () => {
    const content = new TextEncoder().encode("test");
    const hash = await storage.objectStore.store(toAsyncIterable(content));

    const retrieved = await collectAsync(storage.objectStore.load(hash));
    expect(retrieved).toEqual(content);
  });
});
```

### Individual Store Usage

When you need fine-grained control:

```typescript
import {
  InMemoryObjectRepository,
  InMemoryRefStore,
} from "@statewalker/vcs-store-mem";

const objectRepo = new InMemoryObjectRepository();
const refStore = new InMemoryRefStore();

// Use directly
await refStore.setRef("refs/heads/main", "abc123");
const mainRef = await refStore.getRef("refs/heads/main");
```

## Architecture

### Design Decisions

Simplicity drives every design choice. Each store uses straightforward Map or Set data structures with no optimization layers. This transparency helps developers understand exactly what happens during each operation.

The stores share no state between instances. Creating a new storage with `createMemoryStorage()` gives you a completely isolated repository. This isolation is crucial for test reliability.

### Implementation Details

Object storage uses a `Map<string, Uint8Array>` keyed by SHA-1 hash. References use `Map<string, string>` mapping ref names to object hashes. Staging entries track file paths to their staged content and metadata.

The implementation passes all test suites from `@statewalker/vcs-testing`, guaranteeing interface compliance. Any behavior difference between memory and other backends indicates a bug in one of the implementations.

## JGit References

While JGit doesn't ship an in-memory backend in its public API, the concept maps to:

| webrun-vcs | JGit Equivalent |
|------------|-----------------|
| In-memory storage | `org.eclipse.jgit.internal.storage.dfs.InMemoryRepository` |
| DFS abstractions | `org.eclipse.jgit.internal.storage.dfs.DfsObjDatabase` |

The DFS (Distributed File System) layer in JGit provides similar abstraction, though it targets distributed storage rather than in-memory testing.

## Dependencies

**Runtime:**
- `@statewalker/vcs-core` - Interface definitions
- `@statewalker/vcs-utils` - Utilities
- `@statewalker/vcs-sandbox` - Sandbox utilities

**Development:**
- `@statewalker/vcs-testing` - Test suites for validation
- `vitest` - Testing
- `rolldown` - Bundling
- `typescript` - Type definitions

## License

MIT
