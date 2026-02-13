# @statewalker/vcs-port-peerjs

PeerJS DataConnection adapter for MessagePortLike interface.

## Overview

This package wraps PeerJS DataConnections to provide the `MessagePortLike` interface, enabling use with `createPortStream` for binary communication over PeerJS connections.

## Installation

```bash
npm install @statewalker/vcs-port-peerjs peerjs
# or
pnpm add @statewalker/vcs-port-peerjs peerjs
```

## Usage

### Basic Usage with createPortStream

```typescript
import { createPeerJsPortAsync } from "@statewalker/vcs-port-peerjs";
import { createPortStream } from "@statewalker/vcs-utils";
import Peer from "peerjs";

// Create peer and connect
const peer = new Peer();
const conn = peer.connect(remotePeerId, {
  serialization: "raw",  // Required for binary data
  reliable: true
});

// Wait for connection and create port
const port = await createPeerJsPortAsync(conn);
const stream = createPortStream(port);

// Send binary data with ACK-based backpressure
async function* generateData() {
  yield new Uint8Array([1, 2, 3]);
  yield new Uint8Array([4, 5, 6]);
}
await stream.send(generateData());

// Receive binary data
for await (const chunk of stream.receive()) {
  console.log("Received:", chunk);
}
```

### With Duplex Transport for Git Protocol

```typescript
import { createPeerJsPortAsync } from "@statewalker/vcs-port-peerjs";
import { createGitSocketClient, fetchOverDuplex } from "@statewalker/vcs-transport";

const peer = new Peer();
const conn = peer.connect(remotePeerId, {
  serialization: "raw",
  reliable: true,
});

const port = await createPeerJsPortAsync(conn);

// Create a Duplex from the port's read/write/close methods
const duplex = createGitSocketClient({
  io: {
    read: () => portToAsyncIterable(port),
    write: (data) => Promise.resolve(port.postMessage(data)),
    close: () => Promise.resolve(port.close()),
  },
});

// Use Duplex for Git fetch/push operations
const result = await fetchOverDuplex({ duplex, repository, refStore });
```

### Synchronous Port Creation

If the connection is already open, use the synchronous version:

```typescript
import { createPeerJsPort } from "@statewalker/vcs-port-peerjs";

// Only use if conn.open is already true
const port = createPeerJsPort(conn);
```

## API Reference

### createPeerJsPort(conn)

Wrap a PeerJS DataConnection as MessagePortLike synchronously.

```typescript
function createPeerJsPort(conn: DataConnection): PeerJsPort;
```

**Important**: The DataConnection should be created with `{ serialization: "raw" }` for binary data to work correctly.

### createPeerJsPortAsync(conn)

Create PeerJS port and wait for connection to open.

```typescript
function createPeerJsPortAsync(conn: DataConnection): Promise<PeerJsPort>;
```

### PeerJsPort Interface

```typescript
interface PeerJsPort extends MessagePortLike {
  readonly bufferedAmount: number;  // Bytes queued for sending
}
```

## PeerJS Configuration

For best results with binary data:

```typescript
const conn = peer.connect(remotePeerId, {
  serialization: "raw",   // Send binary data directly
  reliable: true,         // TCP-like reliability
});
```

## See Also

- [@statewalker/vcs-port-webrtc](../port-webrtc/) - Direct WebRTC connections
- [@statewalker/vcs-port-websocket](../port-websocket/) - WebSocket connections
- [@statewalker/vcs-transport](../transport/) - Transport layer interfaces

## License

MIT
