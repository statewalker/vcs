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
  // VCS Store adapters (high-level stores)
  createVcsRepositoryAccess,
  VcsRepositoryAccess,
  type VcsRepositoryAccessParams,
  // GitObjectStore adapters
  createCoreRepositoryAccess,
  GitNativeRepositoryAccess,
  type CoreRepositoryAccessOptions,
  // Object graph walking
  createObjectGraphWalker,
  // Wire format utilities
  createGitWireFormat,
  parseGitWireFormat,
  // Legacy adapter
  createStorageAdapter,
  type MinimalStorage,
} from "@statewalker/vcs-transport-adapters";
```

### Key Functions and Classes

| Export | Purpose |
|--------|---------|
| `createVcsRepositoryAccess` | Adapt VCS stores (BlobStore, TreeStore, etc.) to RepositoryAccess |
| `VcsRepositoryAccess` | Class implementing RepositoryAccess with VCS stores |
| `createCoreRepositoryAccess` | Adapt GitObjectStore + RefStore to RepositoryAccess |
| `GitNativeRepositoryAccess` | Direct passthrough to GitObjectStore (object-only, no refs) |
| `createObjectGraphWalker` | Walk object graph for pack generation |
| `createStorageAdapter` | Legacy adapter for MinimalStorage |

## Usage Examples

### Using VCS Stores (Recommended)

For backends that use high-level VCS stores (BlobStore, TreeStore, CommitStore, TagStore, RefStore):

```typescript
import { createVcsRepositoryAccess } from "@statewalker/vcs-transport-adapters";

const repositoryAccess = createVcsRepositoryAccess({
  blobs: myBlobStore,
  trees: myTreeStore,
  commits: myCommitStore,
  tags: myTagStore,
  refs: myRefStore,
});
```

### Using GitObjectStore + RefStore

For backends that use GitObjectStore (stores objects in Git wire format):

```typescript
import { createCoreRepositoryAccess } from "@statewalker/vcs-transport-adapters";

const repositoryAccess = createCoreRepositoryAccess({
  objectStore: myGitObjectStore,
  refStore: myRefStore,
});
```

### Git-Native Storage (Object-Only)

For object-only operations without refs:

```typescript
import { GitNativeRepositoryAccess } from "@statewalker/vcs-transport-adapters";

const objectAccess = new GitNativeRepositoryAccess(gitObjectStore);
```

## Architecture

### Design Decisions

The adapter layer separates storage implementation from protocol handling. Storage backends only need to implement the VCS store interfaces (`CommitStore`, `TreeStore`, `BlobStore`, `RefStore`). The adapters handle all Git-specific formatting.

Two main adapter strategies exist:
- **VcsRepositoryAccess** for storage using high-level VCS stores
- **createCoreRepositoryAccess** for storage using GitObjectStore

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
