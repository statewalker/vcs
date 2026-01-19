# @statewalker/vcs-transport Architecture

This document explains the internal architecture of the transport package, covering the Git protocol implementation, connection handling, and server-side components.

## Design Philosophy

### Protocol Independence

The transport layer separates protocol handling from storage. The `RepositoryAccess` interface abstracts all storage operations, allowing protocol handlers to work with any storage backend:

```
Client ←→ Connection ←→ Protocol Handler ←→ RepositoryAccess ←→ Storage
                              ↓
                        Storage-agnostic
```

### Web Standard APIs

The HTTP server uses native `Request`/`Response` APIs, making it portable across:
- Cloudflare Workers
- Deno Deploy
- Node.js (via adapters)
- Service Workers
- Any environment supporting Fetch API

### Streaming Design

All data transfer uses async iterables for memory-efficient handling of large packs:

```typescript
for await (const packet of connection.receive()) {
  // Process incrementally
}
```

## Module Architecture

```
@statewalker/vcs-transport
├── protocol/           # Wire format (pkt-line, capabilities)
├── connection/         # Transport abstraction (HTTP, git://)
├── negotiation/        # Refspec parsing, URL handling
├── handlers/           # Protocol handlers (UploadPack, ReceivePack)
├── operations/         # High-level operations (fetch, push, clone)
├── http-server/        # Web-standard HTTP server
└── streams/            # Pack receiving, progress reporting

Note: Storage adapters that convert VCS stores to RepositoryAccess are in the
separate @statewalker/vcs-transport-adapters package.
```

## Protocol Layer Deep Dive

### Pkt-Line Format

Git uses a simple framing format for all protocol communication:

```
┌─────────────────────────────────────────┐
│ 4-byte hex length │ payload             │
├─────────────────────────────────────────┤
│ "001e"            │ "# service=git..."  │
└─────────────────────────────────────────┘
```

**Special Markers:**
- `0000` (flush-pkt): End of message/section
- `0001` (delim-pkt): Section delimiter (v2)
- `0002` (response-end): End of response (v2)

**Implementation:**

```typescript
// Encode
function encodePacket(data: Uint8Array): Uint8Array {
  const length = data.length + 4;
  const header = length.toString(16).padStart(4, '0');
  return concat([encode(header), data]);
}

// Decode
function* pktLineReader(input: AsyncIterable<Uint8Array>): Generator<Packet> {
  // Buffers partial packets across chunk boundaries
}
```

### Capabilities

Capabilities advertise supported features during protocol negotiation:

```
# Server advertisement
001e# service=git-upload-pack
00000155ab7...HEAD\0multi_ack_detailed thin-pack side-band-64k...
```

**Common Capabilities:**

| Capability | Purpose |
|------------|---------|
| `multi_ack_detailed` | Detailed ACK responses during negotiation |
| `thin-pack` | Allow deltified objects referencing objects not in pack |
| `side-band-64k` | Multiplex data/progress/errors on single connection |
| `ofs-delta` | Use offset-based delta references |
| `include-tag` | Auto-include tags pointing to fetched objects |
| `shallow` | Support shallow clones |
| `report-status` | Return status after push |
| `atomic` | All-or-nothing ref updates |

### Sideband Multiplexing

Sideband allows multiple data streams over a single connection:

```
┌─────────┬───────────────────────────────┐
│ Channel │ Content                       │
├─────────┼───────────────────────────────┤
│ 1       │ Pack data                     │
│ 2       │ Progress messages (stderr)    │
│ 3       │ Fatal error messages          │
└─────────┴───────────────────────────────┘
```

Each packet starts with a channel byte:

```typescript
function demuxSideband(packet: Uint8Array): { channel: number; data: Uint8Array } {
  return {
    channel: packet[0],
    data: packet.slice(1),
  };
}
```

## Connection Layer Deep Dive

### Connection Abstraction

All connections implement a common interface:

```typescript
interface TransportConnection {
  send(data: AsyncIterable<Uint8Array>): Promise<void>;
  receive(): AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}

interface DiscoverableConnection extends TransportConnection {
  discoverRefs(): Promise<RefAdvertisement>;
}
```

### HTTP Smart Protocol

HTTP transport uses two requests per operation:

```
┌────────────────────────────────────────────────────────────┐
│ Step 1: Discover refs                                       │
│ GET /repo.git/info/refs?service=git-upload-pack            │
│ Response: ref advertisement (capabilities + refs)          │
├────────────────────────────────────────────────────────────┤
│ Step 2: Fetch/Push                                         │
│ POST /repo.git/git-upload-pack                             │
│ Body: want/have/done sequence                              │
│ Response: pack data + progress                             │
└────────────────────────────────────────────────────────────┘
```

**Content Types:**
- Request: `application/x-git-upload-pack-request`
- Response: `application/x-git-upload-pack-result`

### Native Git Protocol

The git:// protocol uses a persistent TCP connection:

```typescript
const connection = createGitConnection({
  host: "github.com",
  port: 9418,  // Default
  path: "/user/repo.git",
});
```

**Initial Request:**
```
0033git-upload-pack /user/repo.git\0host=github.com\0
```

## Handlers Deep Dive

### UploadPackHandler (Fetch)

Handles `git-upload-pack` service for fetch/clone operations:

```
Client                          Server (UploadPackHandler)
   │                                   │
   │ ──── GET info/refs ─────────────► │
   │ ◄──── refs + capabilities ─────── │
   │                                   │
   │ ──── want <oid> ────────────────► │
   │ ──── have <oid> ────────────────► │
   │ ──── have <oid> ────────────────► │
   │ ──── done ──────────────────────► │
   │ ◄──── ACK/NAK ─────────────────── │
   │ ◄──── pack data (sideband) ────── │
   │                                   │
```

**Negotiation State Machine:**

```typescript
interface NegotiationState {
  commonBases: Set<ObjectId>;  // Objects both sides have
  peerHas: Set<ObjectId>;      // Objects client has
  acked: Set<ObjectId>;        // Objects we've ACKed
}

// Multi-ACK modes determine ACK frequency:
// - "off": Single ACK at end
// - "continue": ACK each common object
// - "detailed": ACK with status (common, ready)
```

### ReceivePackHandler (Push)

Handles `git-receive-pack` service for push operations:

```
Client                          Server (ReceivePackHandler)
   │                                   │
   │ ──── GET info/refs ─────────────► │
   │ ◄──── refs + capabilities ─────── │
   │                                   │
   │ ──── old new ref ───────────────► │  ← ref update commands
   │ ──── old new ref ───────────────► │
   │ ──── flush ─────────────────────► │
   │ ──── pack data ─────────────────► │
   │ ◄──── unpack ok ─────────────────│
   │ ◄──── ok ref / ng ref reason ────│  ← report-status
   │                                   │
```

**Ref Update Format:**
```
<old-oid> <new-oid> <ref-name>
```

Example:
```
0000000000000000000000000000000000000000 ab12cd34... refs/heads/feature
```

### Protocol V2 Handler

Git protocol v2 uses explicit commands instead of implicit negotiation:

```typescript
// Client sends command
command=fetch
capability=thin-pack
capability=ofs-delta
want <oid>
have <oid>
done

// Server responds with sections
acknowledgments
shallow-info
packfile
```

**Available Commands:**
- `ls-refs`: List references with filtering
- `fetch`: Fetch objects (improved shallow support)
- `object-info`: Get object metadata without fetching

## Operations Layer

High-level operations coordinate connections and handlers:

### Fetch Operation

```typescript
interface FetchOptions {
  url: string;
  refspecs?: string[];
  auth?: Credentials;
  depth?: number;
  onProgress?: ProgressCallback;
  localHas?: (oid: Uint8Array) => Promise<boolean>;
  localCommits?: () => AsyncIterable<Uint8Array>;
}

interface FetchResult {
  refs: Map<string, Uint8Array>;  // ref name → object ID
  defaultBranch?: string;
  packData: Uint8Array;
  bytesReceived: number;
}
```

**Workflow:**
1. Create connection to remote
2. Discover refs (GET info/refs)
3. Build want list from refspecs
4. Generate have list from local commits
5. Send want/have/done sequence
6. Receive and demultiplex pack data
7. Return refs and pack

### Push Operation

```typescript
interface PushOptions {
  url: string;
  refspecs: string[];
  force?: boolean;
  atomic?: boolean;
  getLocalRef: (name: string) => Promise<ObjectId | undefined>;
  getObjectsToPush: (wants: ObjectId[], haves: ObjectId[]) => AsyncIterable<Uint8Array>;
}

interface PushResult {
  ok: boolean;
  unpackStatus: string;
  updates: RefUpdateResult[];
}
```

**Workflow:**
1. Create connection to remote
2. Discover remote refs
3. Build ref update commands from refspecs
4. Create pack with objects to send
5. Send commands + pack
6. Parse report-status response

## HTTP Server

### Request Routing

```typescript
const server = createGitHttpServer({
  resolveRepository: async (request, repoPath) => {
    return await loadRepository(repoPath);
  },
  authenticate: async (request) => {
    // Verify credentials
  },
  authorize: async (request, repo, service) => {
    // Check permissions
  },
});

// Handle request
const response = await server.fetch(request);
```

**Routes:**

| Method | Path | Handler |
|--------|------|---------|
| GET | `/:repo/info/refs?service=git-upload-pack` | Ref advertisement |
| POST | `/:repo/git-upload-pack` | Fetch request |
| GET | `/:repo/info/refs?service=git-receive-pack` | Ref advertisement |
| POST | `/:repo/git-receive-pack` | Push request |

### Integration Example

```typescript
// Cloudflare Worker
export default {
  async fetch(request: Request): Promise<Response> {
    return gitServer.fetch(request);
  },
};

// Deno
Deno.serve((request) => gitServer.fetch(request));

// Node.js with adapter
import { createServer } from "node:http";
import { toNodeHandler } from "./adapter";

createServer(toNodeHandler(gitServer)).listen(3000);
```

## Storage Adapters

Storage adapters that convert VCS store interfaces to `RepositoryAccess` are provided by the separate `@statewalker/vcs-transport-adapters` package.

### Adapter Pattern

Adapters bridge storage implementations to RepositoryAccess:

```typescript
import { createGitHttpServer } from "@statewalker/vcs-transport";
import { createVcsRepositoryAdapter } from "@statewalker/vcs-transport-adapters/adapters";

const adapter = createVcsRepositoryAdapter({
  objects: repository.objects,
  commits: repository.commits,
  trees: repository.trees,
  refs: repository.refs,
});

const handler = createUploadPackHandler({ repository: adapter });
```

See `@statewalker/vcs-transport-adapters` for the full `RepositoryAccess` interface definition and available adapter implementations.

## Shallow Clone Support

### Shallow Boundaries

Shallow clones limit history depth. The server tracks shallow boundaries:

```typescript
interface ShallowRequest {
  depth?: number;           // Limit to N commits
  deepenSince?: Date;       // Commits after timestamp
  deepenNot?: string[];     // Exclude refs
  deepenRelative?: boolean; // Relative to existing shallow
}
```

### Shallow Negotiation

```
shallow <oid>      # Client reports current shallow boundary
deepen <depth>     # Request N more commits
deepen-since <ts>  # Request commits after timestamp
deepen-not <ref>   # Exclude commits reachable from ref

# Server responds with new boundaries
shallow <oid>      # New shallow commit
unshallow <oid>    # Previously shallow, now complete
```

## Protocol Versions

### Version 1 (Default)

Implicit command structure based on packet sequence:

```
# Fetch
want <oid> capability-list
want <oid>
...
have <oid>
have <oid>
...
done

# Server responds
ACK <oid> / NAK
PACK...
```

### Version 2

Explicit command-based structure:

```
# Request v2
command=fetch
agent=git/2.30.0
capability=thin-pack
capability=ofs-delta
0001           # delim
want <oid>
have <oid>
done
0000           # flush

# Response
acknowledgments
ACK <oid>
0001           # delim
packfile
PACK...
0002           # response-end
```

**Version 2 Benefits:**
- Clearer semantics
- Better for stateless HTTP
- Improved shallow clone support
- Command extensibility

## Extension Points

### Custom Authentication

Implement `AuthProvider` for custom auth flows:

```typescript
interface AuthProvider {
  getCredentials(url: string): Promise<Credentials | undefined>;
  storeCredentials(url: string, credentials: Credentials): Promise<void>;
  rejectCredentials(url: string, credentials: Credentials): Promise<void>;
}
```

### Custom Repositories

Implement `RepositoryAccess` for custom storage:

```typescript
class MyRepositoryAdapter implements RepositoryAccess {
  async *listRefs(prefix?: string) {
    // Query your storage
  }

  async hasObject(oid: Uint8Array) {
    // Check object existence
  }

  // ... other methods
}
```

### Custom Progress Handling

```typescript
await fetch({
  url: "https://github.com/user/repo",
  onProgress: (phase, completed, total) => {
    console.log(`${phase}: ${completed}/${total}`);
  },
  onProgressMessage: (message) => {
    process.stderr.write(message);
  },
});
```

## Testing Patterns

### Protocol Testing

Test protocol handling with mock connections:

```typescript
class MockConnection implements TransportConnection {
  private packets: Packet[] = [];

  async send(data: AsyncIterable<Uint8Array>) {
    for await (const chunk of data) {
      this.packets.push(parsePacket(chunk));
    }
  }

  async *receive(): AsyncIterable<Uint8Array> {
    yield encodePacket(/* mock response */);
  }
}
```

### Handler Testing

Test handlers with mock RepositoryAccess:

```typescript
const mockRepo: RepositoryAccess = {
  listRefs: vi.fn().mockImplementation(async function* () {
    yield { name: "refs/heads/main", oid: hexToBytes("abc123...") };
  }),
  // ... other mocks
};

const handler = createUploadPackHandler({ repository: mockRepo });
const response = await handler.process(request);
```

### End-to-End Testing

Test full fetch/push cycles:

```typescript
// Start mock server
const server = createGitHttpServer({ ... });

// Run operation
const result = await fetch({
  url: "http://localhost:3000/repo.git",
  refspecs: ["+refs/heads/*:refs/remotes/origin/*"],
});

expect(result.refs.size).toBeGreaterThan(0);
```
