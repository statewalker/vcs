# P2P Transport Architecture

## Overview

The P2P transport module enables peer-to-peer Git synchronization over MessagePort-compatible transports. This allows direct browser-to-browser sync without requiring a central Git server.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    P2P Application Layer                         │
│  fetchFromPeer(), pushToPeer(), planBidirectionalSync()          │
│  (packages/transport/src/peer/p2p-operations.ts)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                    Git Protocol Messages
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    Protocol Session Layer                        │
│  ClientProtocolSession: sendHeader, writePacket, readRefs        │
│  ServerProtocolSession: readHeader, writeRefs, readPackets       │
│  (packages/transport/src/streams/protocol-session.ts)            │
└─────────────────────────────────────────────────────────────────┘
                              │
                    GitBidirectionalStream
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    Port-Git Bridge Layer                         │
│  createGitStreamFromPort(): MessagePortLike → GitStream          │
│  AsyncQueue for push-to-pull conversion                          │
│  (packages/transport/src/peer/port-git-stream.ts)                │
└─────────────────────────────────────────────────────────────────┘
                              │
                    MessagePortLike interface
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    Port Stream Layer                             │
│  readStream(), writeStream(): ACK-based backpressure             │
│  (packages/utils/src/streams/port-stream.ts)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────┬───────────────┬───────────────┬───────────────────┐
│ MessagePort │    PeerJS     │   WebRTC DC   │    WebSocket      │
│   (native)  │   (adapter)   │   (adapter)   │    (adapter)      │
└─────────────┴───────────────┴───────────────┴───────────────────┘
```

## Key Components

### 1. Port-Git Bridge (`port-git-stream.ts`)

Bridges the MessagePortLike push-based API to Git's pull-based stream API.

```typescript
interface PortGitStreamResult {
  stream: GitBidirectionalStream;
  writeCompletion: Promise<void>;
  closePort: () => void;
}

function createGitStreamFromPort(
  port: MessagePortLike,
  options?: PortGitStreamOptions
): PortGitStreamResult;
```

**Key challenges solved:**

1. **Push-to-pull conversion**: Uses AsyncQueue to buffer incoming messages for pull-based iteration
2. **Bidirectional communication**: Supports simultaneous read and write operations
3. **Error propagation**: Port errors are propagated to both input and output streams
4. **Resource cleanup**: Proper cleanup of event listeners and port closure

### 2. P2P Client Operations (`p2p-operations.ts`)

Client-side implementations of the Git protocol for P2P communication.

```typescript
// Fetch objects from a peer (git-upload-pack client)
async function fetchFromPeer(
  port: MessagePortLike,
  options?: P2PFetchOptions
): Promise<P2PFetchResult>;

// Push objects to a peer (git-receive-pack client)
async function pushToPeer(
  port: MessagePortLike,
  options: P2PPushOptions
): Promise<P2PPushResult>;
```

**Protocol flow for fetch:**

1. Send protocol header (`git-upload-pack /repo.git host=peer`)
2. Read ref advertisement with capabilities
3. Send wants for objects we need
4. Send haves for objects we already have
5. Send `done` to signal negotiation complete
6. Receive pack data (with optional sideband progress)

**Protocol flow for push:**

1. Send protocol header (`git-receive-pack /repo.git host=peer`)
2. Read ref advertisement with capabilities
3. Send ref updates (`oldOid newOid refName [capabilities]`)
4. Send flush packet
5. Send pack data
6. Read status report

### 3. Bidirectional Sync (`bidirectional-sync.ts`)

Two-way synchronization planning with conflict detection.

```typescript
interface SyncPlan {
  refs: RefSyncPlan[];
  toFetch: string[];
  toPush: string[];
  conflicts: string[];
  needsSync: boolean;
}

async function planBidirectionalSync(
  options: BidirectionalSyncOptions
): Promise<SyncPlan>;
```

**Sync decision logic:**

| Local State | Remote State | isAncestor(local, remote) | isAncestor(remote, local) | Action |
|-------------|--------------|---------------------------|---------------------------|--------|
| OID_A | OID_A | - | - | Up-to-date |
| None | OID_B | - | - | Fetch |
| OID_A | None | - | - | Push |
| OID_A | OID_B | true | false | Fetch (remote ahead) |
| OID_A | OID_B | false | true | Push (local ahead) |
| OID_A | OID_B | false | false | Conflict |

**Conflict resolution strategies:**

- `"conflict"` (default): Report conflicts for manual resolution
- `"prefer-local"`: Push local changes, overwriting remote
- `"prefer-remote"`: Fetch remote changes, overwriting local

### 4. Error Recovery (`error-recovery.ts`)

Comprehensive error handling for unreliable P2P connections.

#### Error Types

```typescript
class PortDisconnectedError extends TransportError;
class PortTimeoutError extends TransportError;
class TransferAbortedError extends TransportError;
```

#### Timeout Utilities

```typescript
// Wrap a promise with timeout
async function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions
): Promise<T>;

// Create resettable idle timeout
function createIdleTimeout(
  timeoutMs: number,
  onTimeout: () => void
): { reset: () => void; cancel: () => void };
```

#### Disconnect Monitoring

```typescript
function createDisconnectMonitor(
  port: MessagePortLike,
  options?: DisconnectMonitorOptions
): DisconnectMonitor;
```

Monitors port for:
- Close events (peer disconnected)
- Error events (transport failures)
- State tracking (connecting → connected → disconnected)

#### Transfer Tracking

```typescript
function createTransferTracker(
  direction: "fetch" | "push",
  refs: Map<string, string>
): TransferTracker;
```

Tracks:
- Bytes transferred
- Expected bytes (for progress)
- Completed objects
- Errors encountered
- Whether transfer can be resumed

#### Retry Logic

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T>;
```

Features:
- Configurable max retries
- Exponential backoff
- Customizable retry predicate
- Abort signal support
- Progress callbacks

#### Combined Wrapper

```typescript
async function wrapP2POperation<T>(
  port: MessagePortLike,
  operation: string,
  fn: (context: P2POperationContext) => Promise<T>,
  options?: P2POperationOptions
): Promise<T>;
```

Combines all error recovery features into a single wrapper:
- Timeout protection
- Disconnect monitoring
- Transfer tracking
- Optional retry logic
- Progress reporting
- Cancellation support

## Data Flow

### Fetch Flow

```
Client (fetchFromPeer)                    Server (serveUploadPack)
         │                                         │
         ├── git-upload-pack /repo ───────────────►│
         │                                         │
         │◄────────── ref advertisement ───────────┤
         │            (refs + capabilities)        │
         │                                         │
         ├── want OID1 capabilities ──────────────►│
         ├── want OID2 ───────────────────────────►│
         ├── 0000 (flush) ────────────────────────►│
         │                                         │
         ├── have OID3 ───────────────────────────►│
         ├── have OID4 ───────────────────────────►│
         ├── done ────────────────────────────────►│
         │                                         │
         │◄────────── NAK ─────────────────────────┤
         │◄────────── pack data ───────────────────┤
         │            (via sideband if supported)  │
         ▼                                         ▼
```

### Push Flow

```
Client (pushToPeer)                       Server (serveReceivePack)
         │                                         │
         ├── git-receive-pack /repo ──────────────►│
         │                                         │
         │◄────────── ref advertisement ───────────┤
         │            (refs + capabilities)        │
         │                                         │
         ├── oldOid newOid refName caps ──────────►│
         ├── 0000 (flush) ────────────────────────►│
         │                                         │
         ├── pack data ───────────────────────────►│
         │                                         │
         │◄────────── unpack status ───────────────┤
         │◄────────── ref status ──────────────────┤
         ▼                                         ▼
```

## Backpressure

The port-stream layer uses ACK-based backpressure to prevent memory exhaustion:

1. Data is sent in chunks (default 64KB)
2. After each chunk, sender waits for ACK
3. Receiver ACKs after processing
4. If ACK not received within timeout, error is thrown

This ensures the receiver controls the flow rate, preventing buffer overflows in slow receivers or congested networks.

## Error Handling Strategy

### Transient Errors (Retryable)

- `PortTimeoutError`: ACK timeout, slow peer
- `PortDisconnectedError`: Peer temporarily disconnected
- Network errors with "timeout" or "disconnect" in message

### Permanent Errors (Non-retryable)

- `TransferAbortedError`: Data corruption, protocol error
- Protocol errors from server
- Authentication failures

### Recovery Approach

```typescript
// Recommended pattern for production use
const result = await wrapP2POperation(
  port,
  "fetch",
  async (ctx) => {
    // Monitor marks connected after successful handshake
    ctx.monitor?.markConnected();

    // Perform the operation
    const data = await fetchFromPeer(port, {
      onProgress: (info) => ctx.reportProgress(info.loaded),
    });

    return data;
  },
  {
    timeoutMs: 60000,        // 1 minute overall timeout
    monitorDisconnect: true, // Detect peer disconnect
    trackTransfer: true,     // Track partial progress
    retry: {
      maxRetries: 3,
      initialDelayMs: 1000,
      backoffMultiplier: 2,
    },
  }
);
```

## Testing

The P2P transport is tested at multiple levels:

### Unit Tests

- `port-git-stream.test.ts`: Port-to-stream bridging
- `bidirectional-sync.test.ts`: Sync planning logic
- `error-recovery.test.ts`: Error handling utilities

### Integration Tests

- `p2p-operations.test.ts`: Client operations with mock servers
- `p2p-transport.test.ts`: End-to-end tests with mock repositories

### Test Utilities

```typescript
// Create connected stream pair for testing
const [streamA, streamB] = createGitStreamPair();

// Use in parallel
await Promise.all([
  clientOperation(streamA),
  serverOperation(streamB),
]);
```

## Performance Considerations

### Chunk Size

- Smaller chunks: More ACK overhead, better responsiveness
- Larger chunks: Less overhead, higher latency per chunk
- Default: 64KB (good balance)

### ACK Timeout

- Too short: False timeouts on slow connections
- Too long: Delayed error detection
- Default: 30 seconds (handles most network conditions)

### Parallel Operations

The architecture supports:
- Multiple concurrent fetches to different peers
- Parallel push and fetch to different refs
- Background sync while user works

## Integration with WebRTC

For browser-to-browser sync, use WebRTC data channels:

```typescript
import { createDataChannelPort } from "@statewalker/vcs-port-webrtc";
import { fetchFromPeer, wrapP2POperation } from "@statewalker/vcs-transport/peer";

const pc = new RTCPeerConnection(config);
const channel = pc.createDataChannel("git-sync", {
  ordered: true,
  protocol: "git-transport",
});

channel.onopen = async () => {
  const port = createDataChannelPort(channel);

  const result = await wrapP2POperation(
    port,
    "fetch",
    async (ctx) => fetchFromPeer(port),
    { timeoutMs: 60000, retry: { maxRetries: 2 } }
  );

  console.log("Synced refs:", result.refs);
};
```

## Future Considerations

### Potential Enhancements

1. **Partial pack support**: Resume interrupted transfers
2. **Delta compression**: More efficient wire format
3. **Multi-peer sync**: Fetch from multiple peers in parallel
4. **Conflict merging**: Automatic 3-way merge for conflicts
5. **Shallow sync**: Transfer only recent history

### Protocol Extensions

The current implementation uses Git protocol v0 for simplicity. Future versions could implement:
- Protocol v2 for better efficiency
- Custom extensions for P2P-specific features (peer discovery, capabilities exchange)
