# @statewalker/vcs-transport-adapters

Storage adapters that bridge VCS store interfaces to Git transport protocol interfaces.

## Overview

This package provides adapters that convert VCS storage interfaces to the `RepositoryFacade` and `RepositoryAccess` interfaces used by Git protocol operations. It enables transport operations (fetch, push, clone, P2P sync) to work with any storage backend that implements the VCS store interfaces.

Two adapter types serve different use cases:

- **`createVcsRepositoryFacade()`** — Creates a `RepositoryFacade` for pack-level operations. Use this with `fetchOverDuplex`, `pushOverDuplex`, `serveOverDuplex`, and HTTP operations.
- **`createVcsRepositoryAccess()`** — Creates a `RepositoryAccess` for object-level server operations. Use this for HTTP server request routing and ref management.

## Installation

```bash
pnpm add @statewalker/vcs-transport-adapters
```

## Usage

### RepositoryFacade (Recommended for Transport Operations)

Use `createVcsRepositoryFacade` when performing fetch, push, clone, or P2P sync:

```typescript
import { fetch, clone, push } from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";

const facade = createVcsRepositoryFacade({ history });

// Clone
const result = await clone({
  url: "https://github.com/user/repo.git",
  repository: facade,
});

// Fetch
await fetch({
  url: "https://github.com/user/repo.git",
  repository: facade,
  refSpecs: ["+refs/heads/*:refs/remotes/origin/*"],
});

// Push
await push({
  url: "https://github.com/user/repo.git",
  repository: facade,
  refSpecs: ["refs/heads/main:refs/heads/main"],
});
```

### RepositoryAccess (For Server-Side Operations)

Use `createVcsRepositoryAccess` when building Git HTTP servers or when you need direct object/ref access:

```typescript
import { createVcsRepositoryAccess } from "@statewalker/vcs-transport-adapters";

const access = createVcsRepositoryAccess({
  blobs: myBlobStore,
  trees: myTreeStore,
  commits: myCommitStore,
  tags: myTagStore,
  refs: myRefStore,
});

// List refs
for await (const ref of access.listRefs()) {
  console.log(ref.name, ref.oid);
}

// Check object existence
const exists = await access.hasObject(objectId);
```

### Git-Native Object Store

For backends that store objects in Git wire format (no serialization needed):

```typescript
import { GitNativeRepositoryAccess } from "@statewalker/vcs-transport-adapters";

const access = new GitNativeRepositoryAccess(gitObjectStore);
```

## Public API

| Export | Description |
|--------|-------------|
| `createVcsRepositoryFacade()` | Create RepositoryFacade from History/HistoryWithOperations |
| `VcsRepositoryFacade` | Class implementing RepositoryFacade |
| `VcsRepositoryFacadeConfig` | Configuration interface |
| `createVcsRepositoryAccess()` | Create RepositoryAccess from individual stores |
| `VcsRepositoryAccess` | Class implementing RepositoryAccess |
| `VcsRepositoryAccessConfig` | Configuration interface |
| `createGitNativeRepositoryAccess()` | Create RepositoryAccess from GitObjectStore |
| `GitNativeRepositoryAccess` | Direct passthrough to GitObjectStore |
| `ObjectGraphWalker` | Walk object graph for pack generation |

## When to Use Which

| Scenario | Use |
|----------|-----|
| HTTP fetch/push/clone | `createVcsRepositoryFacade()` |
| Duplex fetch/push/serve | `createVcsRepositoryFacade()` |
| P2P sync | `createVcsRepositoryFacade()` |
| Git HTTP server | `createVcsRepositoryAccess()` |
| Custom server with ref management | `createVcsRepositoryAccess()` |
| Git-format object store (no VCS stores) | `GitNativeRepositoryAccess` |

## Dependencies

**Runtime:**
- `@statewalker/vcs-core` — VCS store interfaces and types
- `@statewalker/vcs-transport` — Transport API interfaces
- `@statewalker/vcs-utils` — Hashing and serialization utilities

## License

MIT
