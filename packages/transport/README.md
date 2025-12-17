# @webrun-vcs/transport

Git protocol implementation (v1/v2), HTTP transport, and push/pull negotiation.

## Overview

This package enables communication with remote Git repositories over HTTP. It implements the Git wire protocol, handling the low-level details of pkt-line encoding, capability negotiation, and pack file transfer. Use it to fetch objects from remote servers, push local changes, or build Git servers that respond to these operations.

The protocol implementation supports both Git protocol v1 and v2. Protocol v2 offers improved efficiency through command-based communication and ref advertisement filtering, while v1 support ensures compatibility with older servers. The negotiation logic automatically handles capability exchange to establish compatible communication modes.

Beyond client operations, the package includes server-side handlers. The `UploadPackHandler` responds to fetch requests, sending requested objects to clients. The `ReceivePackHandler` accepts push requests, validating and storing incoming changes. These handlers power the HTTP server implementation included in the package.

## Installation

```bash
pnpm add @webrun-vcs/transport
```

## Public API

### Main Export

```typescript
import {
  // HTTP Server
  createGitHttpServer,
  createVcsRepositoryAdapter,
  createVcsServerOptions,
  createStorageAdapter,
  // Protocol handlers
  UploadPackHandler,
  ReceivePackHandler,
  // Connection
  HTTPConnection,
  // Protocol utilities
  PktLineCodec,
  // Types
  type VcsStores,
  type RepositoryAccess,
  type GitHttpServerOptions,
} from "@webrun-vcs/transport";
```

### Sub-exports

| Export Path | Description |
|-------------|-------------|
| `@webrun-vcs/transport/http-server` | Git HTTP server, VCS adapter |
| `@webrun-vcs/transport/protocol` | Pkt-line codec, capabilities, protocol types |
| `@webrun-vcs/transport/negotiation` | Protocol negotiation logic |
| `@webrun-vcs/transport/connection` | HTTP connection implementation |
| `@webrun-vcs/transport/operations` | Remote operations (fetch, push) |
| `@webrun-vcs/transport/streams` | Stream utilities |
| `@webrun-vcs/transport/handlers` | Protocol handlers (UploadPack, ReceivePack) |

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
| `createVcsRepositoryAdapter` | Adapt VCS stores to RepositoryAccess |
| `createVcsServerOptions` | Helper for server configuration |
| `createStorageAdapter` | Legacy adapter for MinimalStorage |

## Usage Examples

### Fetching from a Remote Repository

```typescript
import { HTTPConnection } from "@webrun-vcs/transport/connection";
import { fetchObjects } from "@webrun-vcs/transport/operations";

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
import { HTTPConnection } from "@webrun-vcs/transport/connection";
import { pushObjects } from "@webrun-vcs/transport/operations";

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
import { createGitHttpServer, createVcsRepositoryAdapter } from "@webrun-vcs/transport";

const server = createGitHttpServer({
  async resolveRepository(request, repoPath) {
    // Return VCS stores for the requested repository
    return createVcsRepositoryAdapter({
      objects: myObjectStore,
      refs: myRefStore,
      commits: myCommitStore,
      trees: myTreeStore,
      tags: myTagStore, // optional
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

The `createVcsRepositoryAdapter` function adapts VCS store interfaces to the `RepositoryAccess` interface used by protocol handlers. This approach keeps storage implementation details separate from protocol handling.

For convenience, you can also use `createVcsServerOptions` to configure the server:

```typescript
import { createGitHttpServer, createVcsServerOptions } from "@webrun-vcs/transport";

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

### Working with Pkt-lines

The Git protocol uses pkt-line framing for messages:

```typescript
import { PktLineCodec } from "@webrun-vcs/transport/protocol";

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
import { NegotiationState } from "@webrun-vcs/transport/negotiation";

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

| webrun-vcs | JGit |
|------------|------|
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
- `@webrun-vcs/vcs` - Interface definitions
- `@webrun-vcs/utils` - Hashing, compression, pack utilities

**Development:**
- `vitest` - Testing
- `rolldown` - Bundling
- `typescript` - Type definitions

## License

MIT
