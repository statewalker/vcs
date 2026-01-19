# @statewalker/vcs-transport-adapters

Storage adapters that bridge VCS store interfaces to Git protocol handlers.

## Overview

This package provides adapters that convert VCS storage interfaces (commits, trees, blobs, refs) to the `RepositoryAccess` interface used by Git protocol handlers. It enables Git HTTP servers to work with any storage backend that implements the VCS store interfaces.

The adapters handle the translation between structured VCS objects and Git's wire format. When fetching, they serialize commits, trees, and blobs to the format expected by Git clients. When receiving pushes, they parse incoming pack data and store objects in the appropriate stores.

## Installation

```bash
pnpm add @statewalker/vcs-transport-adapters
```

## Public API

### Main Export

```typescript
import {
  // Adapters
  createVcsRepositoryAdapter,
  createVcsServerOptions,
  createStorageAdapter,
  // Implementations
  GitNativeRepositoryAccess,
  SerializingRepositoryAccess,
  // Types
  type VcsStores,
  type RepositoryAccess,
  type MinimalStorage,
} from "@statewalker/vcs-transport-adapters";
```

### Sub-exports

| Export Path | Description |
|-------------|-------------|
| `@statewalker/vcs-transport-adapters/adapters` | VCS store adapters |
| `@statewalker/vcs-transport-adapters/implementations` | RepositoryAccess implementations |

### Key Functions and Classes

| Export | Purpose |
|--------|---------|
| `createVcsRepositoryAdapter` | Adapt VCS stores to RepositoryAccess |
| `createVcsServerOptions` | Helper for server configuration |
| `createStorageAdapter` | Legacy adapter for MinimalStorage |
| `GitNativeRepositoryAccess` | Direct passthrough to GitObjectStore |
| `SerializingRepositoryAccess` | Serialize typed objects to wire format |

## Usage Examples

### Adapting VCS Stores for Git Server

The primary use case is connecting VCS storage to a Git HTTP server:

```typescript
import { createGitHttpServer } from "@statewalker/vcs-transport";
import { createVcsRepositoryAdapter } from "@statewalker/vcs-transport-adapters/adapters";

const server = createGitHttpServer({
  async resolveRepository(request, repoPath) {
    return createVcsRepositoryAdapter({
      objects: myObjectStore,
      refs: myRefStore,
      commits: myCommitStore,
      trees: myTreeStore,
      tags: myTagStore, // optional
    });
  },
});

const response = await server.fetch(request);
```

### Using createVcsServerOptions Helper

For convenience, use `createVcsServerOptions` to configure the server:

```typescript
import { createGitHttpServer } from "@statewalker/vcs-transport";
import { createVcsServerOptions } from "@statewalker/vcs-transport-adapters/adapters";

const server = createGitHttpServer(
  createVcsServerOptions(
    async (request, repoPath) => ({
      objects: getObjectStore(repoPath),
      refs: getRefStore(repoPath),
      commits: getCommitStore(repoPath),
      trees: getTreeStore(repoPath),
    }),
    { basePath: "/repos/" }
  )
);
```

### Git-Native Storage

For backends that already store objects in Git wire format (like file-based Git repositories), use `GitNativeRepositoryAccess`:

```typescript
import { GitNativeRepositoryAccess } from "@statewalker/vcs-transport-adapters/implementations";

const repositoryAccess = new GitNativeRepositoryAccess(gitObjectStore);
```

This adapter provides direct passthrough with no serialization overhead.

### Serializing Storage

For backends that store typed objects (SQL, KV, Memory), use `SerializingRepositoryAccess`:

```typescript
import { SerializingRepositoryAccess } from "@statewalker/vcs-transport-adapters/implementations";

const repositoryAccess = new SerializingRepositoryAccess(
  commitStore,
  treeStore,
  blobStore,
  tagStore,
);
```

This adapter serializes objects to Git wire format on demand.

## Architecture

### Design Decisions

The adapter layer separates storage implementation from protocol handling. Storage backends only need to implement the VCS store interfaces (`CommitStore`, `TreeStore`, `BlobStore`, `RefStore`). The adapters handle all Git-specific formatting.

Two adapter strategies exist:
- **GitNativeRepositoryAccess** for storage that uses Git's wire format internally
- **SerializingRepositoryAccess** for storage that uses structured/typed objects

### RepositoryAccess Interface

The `RepositoryAccess` interface provides protocol handlers with:

```typescript
interface RepositoryAccess {
  // Object access
  hasObject(id: ObjectId): Promise<boolean>;
  getObjectInfo(id: ObjectId): Promise<ObjectInfo | null>;
  loadObject(id: ObjectId): AsyncIterable<Uint8Array>;
  storeObject(type: ObjectTypeCode, content: Uint8Array): Promise<ObjectId>;

  // Ref access
  listRefs(): AsyncIterable<RefInfo>;
  getHead(): Promise<HeadInfo | null>;
  updateRef(name: string, oldId: string | null, newId: string | null): Promise<boolean>;

  // Object walking
  walkObjects(wants: string[], haves: string[]): AsyncIterable<ObjectInfo>;
}
```

## Dependencies

**Runtime:**
- `@statewalker/vcs-core` - VCS store interfaces and types
- `@statewalker/vcs-transport` - Protocol handler types
- `@statewalker/vcs-utils` - Hashing and serialization utilities

**Development:**
- `vitest` - Testing
- `rolldown` - Bundling
- `typescript` - Type definitions

## License

MIT
