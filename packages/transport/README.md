# @statewalker/vcs-transport

Git protocol implementation (v1/v2), HTTP transport, and push/pull negotiation.

## Overview

This package enables communication with remote Git repositories over HTTP. It implements the Git wire protocol, handling the low-level details of pkt-line encoding, capability negotiation, and pack file transfer. Use it to fetch objects from remote servers, push local changes, or build Git servers that respond to these operations.

The protocol implementation supports both Git protocol v1 and v2. Protocol v2 offers improved efficiency through command-based communication and ref advertisement filtering, while v1 support ensures compatibility with older servers. The negotiation logic automatically handles capability exchange to establish compatible communication modes.

Beyond client operations, the package includes server-side handlers. The `UploadPackHandler` responds to fetch requests, sending requested objects to clients. The `ReceivePackHandler` accepts push requests, validating and storing incoming changes. These handlers power the HTTP server implementation included in the package.

## Installation

```bash
pnpm add @statewalker/vcs-transport
```

## Public API

### Main Export

```typescript
import {
  // HTTP Server
  createGitHttpServer,
  // Protocol handlers
  UploadPackHandler,
  ReceivePackHandler,
  // Connection
  HTTPConnection,
  // Protocol utilities
  PktLineCodec,
  // Types
  type RepositoryAccess,
  type GitHttpServerOptions,
} from "@statewalker/vcs-transport";

// Storage adapters are in the separate transport-adapters package
import {
  createVcsRepositoryAccess,
  createCoreRepositoryAccess,
  createStorageAdapter,
} from "@statewalker/vcs-transport-adapters";
```

### Sub-exports

| Export Path | Description |
|-------------|-------------|
| `@statewalker/vcs-transport/protocol` | Pkt-line codec, capabilities, protocol types |
| `@statewalker/vcs-transport/negotiation` | Protocol negotiation logic |
| `@statewalker/vcs-transport/connection` | HTTP connection implementation |
| `@statewalker/vcs-transport/operations` | Remote operations (fetch, push) |
| `@statewalker/vcs-transport/streams` | Stream utilities |
| `@statewalker/vcs-transport/peer` | P2P transport over MessagePort |

### Key Classes and Functions

| Export | Purpose |
|--------|---------|
| `HTTPConnection` | HTTP transport for Git smart protocol |
| `PktLineCodec` | Pkt-line encoding and decoding |
| `UploadPackHandler` | Server-side fetch handling |
| `ReceivePackHandler` | Server-side push handling |
| `ProtocolV2Handler` | Protocol v2 support |
| `NegotiationState` | Negotiation state machine |
| `createGitHttpServer` | Create HTTP server instance |

### P2P Transport Classes

| Export | Purpose |
|--------|---------|
| `fetchFromPeer` | Fetch objects from peer over MessagePort |
| `pushToPeer` | Push objects to peer over MessagePort |
| `createGitStreamFromPort` | Bridge MessagePort to Git protocol stream |
| `planBidirectionalSync` | Plan two-way sync with conflict detection |
| `withTimeout` | Timeout wrapper for async operations |
| `withRetry` | Retry wrapper with exponential backoff |
| `createDisconnectMonitor` | Monitor port disconnect events |
| `createTransferTracker` | Track partial transfer state |

**Note:** Storage adapters (`createVcsRepositoryAccess`, `createCoreRepositoryAccess`, `createStorageAdapter`) are now in `@statewalker/vcs-transport-adapters`.

## Usage Examples

### Fetching from a Remote Repository

```typescript
import { HTTPConnection } from "@statewalker/vcs-transport/connection";
import { fetchObjects } from "@statewalker/vcs-transport/operations";

const connection = new HTTPConnection("https://github.com/user/repo.git");

// Discover refs on the remote
const refs = await connection.discoverRefs();
console.log("Remote refs:", refs);

// Fetch specific refs
const result = await fetchObjects({
  connection,
  storage,
  wants: ["refs/heads/main"],
  haves: [], // Empty for initial clone
});

console.log(`Received ${result.objectCount} objects`);
```

### Pushing to a Remote

```typescript
import { HTTPConnection } from "@statewalker/vcs-transport/connection";
import { pushObjects } from "@statewalker/vcs-transport/operations";

const connection = new HTTPConnection("https://github.com/user/repo.git");

// Set up authentication if needed
connection.setAuth({ username: "user", password: "token" });

const result = await pushObjects({
  connection,
  storage,
  updates: [
    {
      refName: "refs/heads/main",
      oldHash: "abc123...",
      newHash: "def456...",
    },
  ],
});

if (result.success) {
  console.log("Push successful");
}
```

### Setting Up a Git HTTP Server

The transport package includes a complete HTTP server implementation that responds to Git smart protocol requests. The server works with any storage backend that implements the VCS interfaces.

```typescript
import { createGitHttpServer } from "@statewalker/vcs-transport";
import { createVcsRepositoryAccess } from "@statewalker/vcs-transport-adapters";

const server = createGitHttpServer({
  async resolveRepository(request, repoPath) {
    // Return VCS stores for the requested repository
    return createVcsRepositoryAccess({
      blobs: myBlobStore,
      trees: myTreeStore,
      commits: myCommitStore,
      tags: myTagStore,
      refs: myRefStore,
    });
  },
  // Optional configuration
  basePath: "/git/",
  authenticate: async (request) => true,
  authorize: async (request, repo, operation) => {
    // operation is "fetch" or "push"
    return true;
  },
});

// Handle requests (compatible with Deno, Node, Cloudflare Workers)
const response = await server.fetch(request);
```

The `createVcsRepositoryAccess` function adapts VCS store interfaces to the `RepositoryAccess` interface used by protocol handlers. This approach keeps storage implementation details separate from protocol handling.

#### Platform Integration Examples

The server uses Web Standard APIs (`Request`/`Response`), making it portable across different runtimes:

**Cloudflare Workers:**

```typescript
import { createGitHttpServer } from "@statewalker/vcs-transport";
import { createVcsRepositoryAccess } from "@statewalker/vcs-transport-adapters";

export default {
  async fetch(request: Request): Promise<Response> {
    const server = createGitHttpServer({
      async resolveRepository(req, repoPath) {
        const stores = await getRepositoryStores(repoPath);
        return createVcsRepositoryAccess(stores);
      },
    });
    return server.fetch(request);
  },
};
```

**Deno:**

```typescript
import { createGitHttpServer } from "@statewalker/vcs-transport";
import { createVcsRepositoryAccess } from "@statewalker/vcs-transport-adapters";

const server = createGitHttpServer({ /* ... */ });
Deno.serve((request) => server.fetch(request));
```

**Node.js:**

```typescript
import { createServer } from "node:http";
import { createGitHttpServer } from "@statewalker/vcs-transport";
import { createVcsRepositoryAccess } from "@statewalker/vcs-transport-adapters";

const gitServer = createGitHttpServer({ /* ... */ });

createServer(async (req, res) => {
  const request = new Request(`http://localhost${req.url}`, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: req.method !== "GET" ? req : undefined,
  });

  const response = await gitServer.fetch(request);

  res.statusCode = response.status;
  for (const [key, value] of response.headers) {
    res.setHeader(key, value);
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(3000);
```

#### Authentication Patterns

The server supports flexible authentication through callback hooks:

```typescript
import { createGitHttpServer } from "@statewalker/vcs-transport";
import { createVcsRepositoryAccess } from "@statewalker/vcs-transport-adapters";

const server = createGitHttpServer({
  async resolveRepository(request, repoPath) {
    return createVcsRepositoryAccess(await loadRepository(repoPath));
  },

  // Authenticate the request (called before any operation)
  async authenticate(request) {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Basic ")) {
      return false;
    }

    const [username, password] = atob(auth.slice(6)).split(":");
    return await validateCredentials(username, password);
  },

  // Authorize specific operations (called after authentication)
  async authorize(request, repository, operation) {
    // operation is "fetch" or "push"
    const user = await getUserFromRequest(request);

    if (operation === "push") {
      // Only allow push for repository owners
      return user.canPushTo(repository);
    }

    // Allow fetch for all authenticated users
    return true;
  },
});
```

When authentication fails, the server returns a 401 status with a `WWW-Authenticate` header prompting for credentials.

### P2P Transport over MessagePort

The transport package supports peer-to-peer Git operations over any MessagePortLike transport (WebRTC, WebSocket, PeerJS). This enables direct browser-to-browser synchronization without a central Git server.

#### Fetching from a Peer

```typescript
import { wrapNativePort } from "@statewalker/vcs-utils";
import { fetchFromPeer } from "@statewalker/vcs-transport/peer";

const channel = new MessageChannel();
const port = wrapNativePort(channel.port1);

// Fetch refs and objects from a peer
const result = await fetchFromPeer(port, {
  localHaves: ["abc123..."], // Objects we already have
  onProgress: (info) => console.log(`${info.phase}: ${info.loaded}/${info.total}`),
});

console.log("Remote refs:", result.refs);
if (result.packData) {
  // Process pack data with core package
  await applyPack(result.packData);
}
```

#### Pushing to a Peer

```typescript
import { wrapNativePort } from "@statewalker/vcs-utils";
import { pushToPeer } from "@statewalker/vcs-transport/peer";

const port = wrapNativePort(channel.port1);

const result = await pushToPeer(port, {
  updates: [
    { refName: "refs/heads/main", oldOid: "abc...", newOid: "def..." },
  ],
  packData: packFile, // Pre-generated pack data
});

if (result.success) {
  console.log("Push successful!");
} else {
  console.log("Errors:", result.errors);
}
```

#### Bidirectional Sync

Plan two-way synchronization with conflict detection:

```typescript
import { planBidirectionalSync } from "@statewalker/vcs-transport/peer";

const plan = await planBidirectionalSync({
  localRefs: [{ name: "refs/heads/main", objectId: "abc..." }],
  remoteRefs: [{ name: "refs/heads/main", objectId: "def..." }],
  isAncestor: async (ancestor, descendant) => checkAncestry(ancestor, descendant),
  conflictResolution: "conflict", // or "prefer-local" or "prefer-remote"
});

console.log("Refs to fetch:", plan.toFetch);
console.log("Refs to push:", plan.toPush);
console.log("Conflicts:", plan.conflicts);
```

#### Error Recovery

The P2P transport includes comprehensive error recovery:

```typescript
import {
  withTimeout,
  withRetry,
  createDisconnectMonitor,
  wrapP2POperation,
} from "@statewalker/vcs-transport/peer";

// Wrap an operation with timeout
const result = await withTimeout(
  fetchFromPeer(port),
  { timeoutMs: 30000, operation: "fetch" }
);

// Automatic retry with exponential backoff
const result = await withRetry(
  () => fetchFromPeer(port),
  {
    maxRetries: 3,
    initialDelayMs: 1000,
    onRetry: (attempt, err, delay) => {
      console.log(`Retry ${attempt} after ${delay}ms: ${err.message}`);
    },
  }
);

// Full-featured operation wrapper
const result = await wrapP2POperation(
  port,
  "fetch",
  async (ctx) => {
    ctx.monitor?.markConnected();
    const data = await fetchFromPeer(port);
    ctx.reportProgress(data.bytesReceived);
    return data;
  },
  {
    timeoutMs: 60000,
    monitorDisconnect: true,
    trackTransfer: true,
    retry: { maxRetries: 2 },
  }
);
```

See [P2P Architecture](./docs/P2P-ARCHITECTURE.md) for more details.

### Working with Pkt-lines

The Git protocol uses pkt-line framing for messages:

```typescript
import { PktLineCodec } from "@statewalker/vcs-transport/protocol";

const codec = new PktLineCodec();

// Encode a message
const encoded = codec.encode("want abc123...\n");

// Decode pkt-lines from a stream
for await (const line of codec.decode(stream)) {
  if (line === null) {
    // Flush packet (0000)
    continue;
  }
  console.log("Received:", line);
}
```

### Protocol Negotiation

```typescript
import { NegotiationState } from "@statewalker/vcs-transport/negotiation";

const negotiation = new NegotiationState({
  wants: ["abc123..."],
  haves: ["def456...", "789abc..."],
});

// Generate negotiation messages
while (!negotiation.isDone()) {
  const message = negotiation.nextMessage();
  const response = await sendToServer(message);
  negotiation.processResponse(response);
}
```

## Architecture

### Design Decisions

The protocol implementation separates wire format handling from transport mechanics. The `PktLineCodec` handles framing, while transport classes like `HTTPConnection` handle the actual network communication. This separation allows testing protocol logic without network dependencies.

Server-side handlers are stateless, processing one request at a time. State lives in the storage layer, not the handlers. This design simplifies deployment and enables horizontal scaling.

### Implementation Details

**Pkt-line Format** prefixes each line with a 4-character hex length. Special values include `0000` (flush), `0001` (delimiter), and `0002` (response end). The codec handles all these cases transparently.

**Capability Negotiation** happens during the initial ref advertisement exchange. Both sides announce their capabilities, and the intersection determines available features. Common capabilities include `multi_ack`, `thin-pack`, `side-band-64k`, and `agent`.

**Side-band Multiplexing** sends pack data and progress messages over the same connection. Channel 1 carries pack data, channel 2 carries progress, and channel 3 carries errors. The implementation demultiplexes automatically.

**Pack Transfer** uses Git's efficient pack format. For fetches, the server computes which objects the client needs and sends a minimal pack. For pushes, the client sends a pack containing new objects.

## JGit References

This package closely mirrors JGit's transport implementation:

| StateWalker VCS | JGit |
|-----------------|------|
| `HTTPConnection` | `TransportHttp`, `HttpTransport` |
| `PktLineCodec` | `PacketLineIn`, `PacketLineOut` |
| `UploadPackHandler` | `UploadPack` |
| `ReceivePackHandler` | `ReceivePack` |
| Protocol v2 | `ProtocolV2Parser` |
| Negotiation | `BasePackFetchConnection` |
| Capabilities | `GitProtocolConstants` |
| Side-band | `SideBandInputStream`, `SideBandOutputStream` |

## Dependencies

**Runtime:**
- `@statewalker/vcs-core` - Interface definitions
- `@statewalker/vcs-utils` - Hashing, compression, pack utilities

**Development:**
- `vitest` - Testing
- `rolldown` - Bundling
- `typescript` - Type definitions

## License

MIT
