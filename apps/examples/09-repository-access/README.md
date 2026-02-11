# 09-repository-access

Exposes a repository for transport operations using RepositoryAccess, RepositoryFacade, and RefStore. This example creates a server repository, demonstrates low-level and pack-level access patterns, then serves and fetches content over a MessagePort duplex stream.

## Quick Start

```bash
# From the monorepo root
pnpm install
pnpm --filter @statewalker/vcs-example-09-repository-access start
```

## What You'll Learn

- Creating RepositoryAccess from a History instance for byte-level protocol operations
- Creating RepositoryFacade for pack-level import/export
- Adapting core Refs to the transport RefStore interface
- Using serveOverDuplex to serve Git requests over any duplex stream
- Using fetchOverDuplex to fetch from a served repository
- Building a MessagePort-based duplex adapter with close markers

## Prerequisites

- Node.js 18+
- pnpm
- Completed [08-transport-basics](../08-transport-basics/)

---

## Step-by-Step Guide

### Creating and Populating a Server Repository

**File:** [src/main.ts](src/main.ts)

The example starts by setting up a memory-backed repository with a blob, tree, and commit, then pointing `refs/heads/main` at the commit.

```typescript
const serverHistory = createMemoryHistoryWithOperations();
await serverHistory.initialize();
await serverHistory.refs.setSymbolic("HEAD", "refs/heads/main");

const blobId = await serverHistory.blobs.store([
  encoder.encode("# Hello from Server\n\nThis file was served via transport."),
]);
const treeId = await serverHistory.trees.store([
  { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId },
]);
const commitId = await serverHistory.commits.store({
  tree: treeId,
  parents: [],
  author: { name: "Server", email: "server@example.com", timestamp: now, tzOffset: "+0000" },
  committer: { name: "Server", email: "server@example.com", timestamp: now, tzOffset: "+0000" },
  message: "Initial commit from server",
});
await serverHistory.refs.set("refs/heads/main", commitId);
```

**Key APIs:**
- `createMemoryHistoryWithOperations()` - In-memory History with full operations support
- `History.blobs.store()` / `History.trees.store()` / `History.commits.store()` - Object creation
- `History.refs.setSymbolic()` - Create symbolic ref (HEAD -> refs/heads/main)

---

### RepositoryAccess: Byte-Level Operations

**File:** [src/main.ts](src/main.ts)

RepositoryAccess provides low-level, byte-oriented operations that protocol handlers use to inspect and traverse objects.

```typescript
const repoAccess = createVcsRepositoryAccess({ history: serverHistory });

const hasCommit = await repoAccess.hasObject(commitId);
const commitInfo = await repoAccess.getObjectInfo(commitId);
const headInfo = await repoAccess.getHead();

for await (const ref of repoAccess.listRefs()) {
  console.log(`${ref.name} -> ${ref.objectId.slice(0, 7)}`);
}

for await (const obj of repoAccess.walkObjects([commitId], [])) {
  console.log(`${typeNames[obj.type]}: ${obj.id.slice(0, 7)} (${obj.content.length} bytes)`);
}
```

**Key APIs:**
- `createVcsRepositoryAccess({ history })` - Create access adapter from a History instance
- `RepositoryAccess.hasObject(id)` - Check if an object exists
- `RepositoryAccess.getObjectInfo(id)` - Get object type and size
- `RepositoryAccess.getHead()` - Get HEAD target info
- `RepositoryAccess.listRefs()` - Enumerate all refs
- `RepositoryAccess.walkObjects(wants, haves)` - Traverse the object graph

---

### RepositoryFacade and RefStore Adapter

**File:** [src/main.ts](src/main.ts)

RepositoryFacade works at the pack level, handling import and export of pack streams. The RefStore adapter bridges the core Refs interface to the simpler transport RefStore contract.

```typescript
const serverFacade: RepositoryFacade = createVcsRepositoryFacade({
  history: serverHistory,
  serialization: serverHistory.serialization,
});

const serverRefStore: RefStore = createRefStoreAdapter(serverHistory.refs);

for await (const chunk of serverFacade.exportPack(new Set([commitId]), new Set())) {
  packSize += chunk.length;
}

const allRefs = await serverRefStore.listAll();
```

**Key APIs:**
- `createVcsRepositoryFacade({ history, serialization })` - Create facade for pack operations
- `RepositoryFacade.exportPack(wants, exclude)` - Generate a pack stream
- `RepositoryFacade.importPack(stream)` - Import a pack stream
- `RepositoryFacade.has(oid)` - Check object existence
- `RefStore.listAll()` - List all refs as `[name, oid]` pairs
- `RefStore.get(name)` / `RefStore.update(name, oid)` - Read and write individual refs

---

### The RefStore Adapter Pattern

**File:** [src/main.ts](src/main.ts)

The transport layer uses a simpler ref interface than core. This adapter bridges the gap:

```typescript
function createRefStoreAdapter(refs: Refs): RefStore {
  return {
    async get(name: string): Promise<string | undefined> {
      const resolved = await refs.resolve(name);
      return resolved?.objectId;
    },
    async update(name: string, oid: string): Promise<void> {
      await refs.set(name, oid);
    },
    async listAll(): Promise<Iterable<[string, string]>> {
      const result: [string, string][] = [];
      for await (const entry of refs.list()) {
        if ("objectId" in entry && entry.objectId !== undefined) {
          result.push([entry.name, entry.objectId]);
        }
      }
      return result;
    },
  };
}
```

**Key APIs:**
- `Refs.resolve(name)` - Core interface: resolves refs including symbolic refs
- `RefStore.get(name)` - Transport interface: returns `string | undefined` directly
- `RefStore.update(name, oid)` - Transport interface: simplified set

---

### Serving and Fetching Over a Duplex Stream

**File:** [src/main.ts](src/main.ts)

With the facade and ref store ready, you can serve the repository over any bidirectional stream. This example uses Node's MessageChannel to create a duplex pair, then runs the server and client concurrently.

```typescript
const channel = new MessageChannel();
const serverDuplex = createMessagePortDuplex(channel.port1);
const clientDuplex = createMessagePortDuplex(channel.port2);

const [serveResult, fetchResult] = await Promise.all([
  serveOverDuplex({
    duplex: serverDuplex,
    repository: serverFacade,
    refStore: serverRefStore,
    service: "git-upload-pack",
  }),
  fetchOverDuplex({
    duplex: clientDuplex,
    repository: clientFacade,
    refStore: clientRefStore,
  }),
]);
```

**Key APIs:**
- `serveOverDuplex({ duplex, repository, refStore, service })` - Serve Git requests over a duplex stream
- `fetchOverDuplex({ duplex, repository, refStore })` - Fetch from a served repository
- `MessageChannel` - Node.js built-in for creating paired message ports

---

## Key Concepts

### RepositoryAccess vs RepositoryFacade

Two interfaces bridge History to the transport layer at different abstraction levels. RepositoryAccess is byte-oriented, giving protocol handlers direct access to individual objects by ID: check existence, read type and size, load raw content, and walk the object graph. RepositoryFacade is pack-oriented, operating at the level of pack streams that the transport FSM produces and consumes. When building a transport server, you typically use both: the facade for pack negotiation and the access layer for ref advertisement and object inspection.

### RefStore Adapter

The core `Refs` interface supports symbolic refs, resolution chains, and async iteration over entries. The transport layer needs something simpler: `get(name)` returning a plain object ID string, `update(name, oid)` for writes, and `listAll()` returning flat `[name, oid]` pairs. The adapter pattern shown in this example bridges that gap by resolving symbolic refs and filtering entries down to concrete object IDs.

### Serving Over Duplex

Any bidirectional stream (MessagePort, WebSocket, WebRTC DataChannel) can serve as a transport channel. The `serveOverDuplex` function handles the server side of the Git smart protocol, advertising refs and sending pack data. On the client side, `fetchOverDuplex` performs the negotiation and receives objects. Running both sides through `Promise.all` lets you test the full round-trip in a single process, which is the pattern this example demonstrates with `MessageChannel`.

---

## Project Structure

```
apps/examples/09-repository-access/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    └── main.ts          # All steps in a single file
```

---

## Output Example

```
=== Step 1: Create Server Repository ===

  Server commit: a3f1e2b
  Server blob:   8c4d7a1
  Server tree:   5e9b0c3

=== Step 2: Create RepositoryAccess ===

  hasObject(a3f1e2b): true
  getObjectInfo: type=commit size=198
  getHead: target=refs/heads/main
  listRefs:
    refs/heads/main -> a3f1e2b
  walkObjects (from commit, no exclusions):
    commit: a3f1e2b (198 bytes)
    tree: 5e9b0c3 (37 bytes)
    blob: 8c4d7a1 (55 bytes)
  Total objects walked: 3

=== Step 3: Create RepositoryFacade & RefStore ===

  facade.has(a3f1e2b): true
  Exporting pack (wants=[commit], haves=[]):
    Pack size: 312 bytes
  RefStore.listAll():
    refs/heads/main -> a3f1e2b

=== Step 4: Serve Over Duplex (MessagePort) ===

  Server result: success=true
  Client result: refs fetched=1
  Client received commit: "Initial commit from server"

=== Summary ===

Key interfaces demonstrated:
  - RepositoryAccess: Low-level byte-level protocol operations
  - RepositoryFacade: Pack-level import/export operations
  - RefStore: Transport-compatible ref storage adapter
  - serveOverDuplex: Serve Git requests over any duplex stream
  - fetchOverDuplex: Fetch from a served repository

Adapter functions:
  - createVcsRepositoryAccess({ history })
  - createVcsRepositoryFacade({ history, serialization })
  - createRefStoreAdapter(refs)  (see code in this example)

Example completed successfully!
```

---

## API Reference Links

### Transport Package (packages/transport)

| Interface / Function | Location | Purpose |
|----------------------|----------|---------|
| `RepositoryFacade` | [api/repository-facade.ts](../../../packages/transport/src/api/repository-facade.ts) | Pack-level import/export interface |
| `RepositoryAccess` | [api/repository-access.ts](../../../packages/transport/src/api/repository-access.ts) | Byte-level protocol operations |
| `RefStore` | [api/options.ts](../../../packages/transport/src/api/options.ts) | Transport-compatible ref storage |
| `serveOverDuplex` | [operations/serve-over-duplex.ts](../../../packages/transport/src/operations/serve-over-duplex.ts) | Serve Git requests over duplex |
| `fetchOverDuplex` | [operations/fetch-over-duplex.ts](../../../packages/transport/src/operations/fetch-over-duplex.ts) | Fetch from a served repository |

### Transport Adapters Package (packages/transport-adapters)

| Interface / Function | Location | Purpose |
|----------------------|----------|---------|
| `createVcsRepositoryAccess` | [vcs-repository-access.ts](../../../packages/transport-adapters/src/vcs-repository-access.ts) | Create RepositoryAccess from History |
| `createVcsRepositoryFacade` | [vcs-repository-facade.ts](../../../packages/transport-adapters/src/vcs-repository-facade.ts) | Create RepositoryFacade from History |

### Core Package (packages/core)

| Interface / Function | Location | Purpose |
|----------------------|----------|---------|
| `Refs` | [history/refs/](../../../packages/core/src/history/refs/) | Core ref storage interface |
| `History` | [history/](../../../packages/core/src/history/) | Main repository interface |

---

## Next Steps

- [08-transport-basics](../08-transport-basics/) - HTTP transport operations (ls-remote, clone, fetch)
- [10-custom-storage](../10-custom-storage/) - Building custom storage backends
- [WebRTC P2P Sync Demo](../../demos/webrtc-p2p-sync/) - Real-world peer-to-peer synchronization
