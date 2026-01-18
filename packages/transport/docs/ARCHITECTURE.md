# Transport Architecture

## Overview

The transport layer provides reliable, backpressure-aware communication for git protocol packets over various network transports (WebRTC, WebSocket, PeerJS).

## Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Application Layer                          │
│  TransportConnection: send(Packet[]) / receive(): Packet[]      │
│  (packages/transport)                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
           pktLineWriter/pktLineReader + toChunks
                              │
┌─────────────────────────────────────────────────────────────────┐
│                      Port Stream Layer                          │
│  createPortStream(): ACK-based backpressure                     │
│  (packages/utils/src/streams/port-stream.ts)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                     MessagePortLike interface
                              │
┌─────────────────────┬──────────────────┬───────────────────────┐
│   port-peerjs       │   port-webrtc    │   port-websocket      │
│   (PeerJS adapter)  │   (RTCDataChannel)│   (WebSocket)        │
└─────────────────────┴──────────────────┴───────────────────────┘
```

## Key Components

### 1. MessagePortLike Interface

Minimal interface for transport adapters, defined in `@statewalker/vcs-utils`:

```typescript
interface MessagePortLike {
  postMessage(data: ArrayBuffer | Uint8Array): void;
  onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null;
  onerror: ((error: Error) => void) | null;
  onclose: (() => void) | null;
  close(): void;
  start(): void;
  readonly isOpen: boolean;
}
```

This interface abstracts away the differences between MessagePort, WebSocket, RTCDataChannel, and PeerJS DataConnection.

### 2. Port Stream Layer

The port stream layer (`createPortStream`) provides ACK-based backpressure over MessagePortLike:

```typescript
import { createPortStream } from "@statewalker/vcs-utils";

const stream = createPortStream(port);

// Send binary data with backpressure
await stream.send(asyncIterableOfUint8Array);

// Receive binary data
for await (const chunk of stream.receive()) {
  // Process chunk
}
```

#### Binary Protocol Format

Each message is a `Uint8Array` with the structure:
- `[type: 1 byte][id: 4 bytes big-endian][payload: variable]`

Message types:
- **DATA (0)**: Block to transfer
- **ACK (1)**: Acknowledgment (payload: 1=handled, 0=rejected)
- **END (2)**: Stream complete
- **ERROR (3)**: Error (JSON payload)

#### Backpressure Flow

1. Sender sends DATA message with block ID
2. Sender blocks waiting for ACK (with timeout)
3. Receiver processes data asynchronously
4. Receiver sends ACK after processing
5. Sender sends next block (or END)

This ensures the receiver controls the flow rate, preventing memory exhaustion.

### 3. TransportConnection

High-level interface for git protocol communication:

```typescript
interface TransportConnection {
  send(packets: AsyncIterable<Packet>): Promise<void>;
  sendRaw(data: Uint8Array): Promise<void>;
  receive(): AsyncIterable<Packet>;
  close(): Promise<void>;
  readonly isClosed: boolean;
}
```

The `PortTransportConnection` implementation:
- Encodes packets using pkt-line format
- Chunks data into configurable block sizes
- Uses the port stream layer for reliable transfer
- Decodes received data back to packets

### 4. Port Adapters

| Package | Transport | Use Case |
|---------|-----------|----------|
| `port-peerjs` | PeerJS DataConnection | Easy WebRTC with TURN fallback |
| `port-webrtc` | RTCDataChannel | Direct browser-to-browser |
| `port-websocket` | WebSocket | Server-mediated sync |

## Usage Examples

### Basic Setup with PeerJS

```typescript
import { createPeerJsPort } from "@statewalker/vcs-port-peerjs";
import { createPortTransportConnection } from "@statewalker/vcs-transport";
import Peer from "peerjs";

const peer = new Peer();
const conn = peer.connect(remotePeerId, {
  serialization: "raw",
  reliable: true,
});

conn.on("open", async () => {
  const port = createPeerJsPort(conn);
  const transport = createPortTransportConnection(port, {
    blockSize: 64 * 1024,  // 64KB blocks
    ackTimeout: 30000,     // 30s timeout
  });

  // Send git packets
  await transport.send(generatePackets());

  // Receive git packets
  for await (const packet of transport.receive()) {
    handlePacket(packet);
  }
});
```

### WebRTC Data Channel

```typescript
import { createDataChannelPort } from "@statewalker/vcs-port-webrtc";
import { createPortTransportConnection } from "@statewalker/vcs-transport";

const pc = new RTCPeerConnection();
const channel = pc.createDataChannel("sync", { ordered: true });

channel.onopen = () => {
  const port = createDataChannelPort(channel);
  const transport = createPortTransportConnection(port);
  // Use transport...
};
```

### WebSocket

```typescript
import { createWebSocketPortAsync } from "@statewalker/vcs-port-websocket";
import { createPortTransportConnection } from "@statewalker/vcs-transport";

const port = await createWebSocketPortAsync("wss://example.com/sync");
const transport = createPortTransportConnection(port);
// Use transport...
```

## Configuration Options

### PortTransportConnection Options

| Option | Default | Description |
|--------|---------|-------------|
| `blockSize` | 65536 | Max bytes per block sent over the wire |
| `ackTimeout` | 30000 | Milliseconds to wait for ACK before error |

### Performance Tuning

- **Block size**: Larger blocks reduce overhead but increase latency for each block
- **ACK timeout**: Balance between allowing slow receivers and detecting failures
- **Chunk size**: The port stream can further chunk data for the underlying transport

## Error Handling

### Connection Errors

```typescript
port.onerror = (error) => {
  console.error("Transport error:", error);
};

port.onclose = () => {
  console.log("Connection closed");
};
```

### ACK Timeout

If ACK is not received within the timeout period, the send operation throws:
```
Error: ACK timeout for block 42
```

### Stream Errors

Errors from the sender are propagated to the receiver via the ERROR message type.

## Implementation Notes

### Native MessagePort Wrapper

For native `MessagePort`, use `wrapNativePort`:

```typescript
import { wrapNativePort } from "@statewalker/vcs-utils";

const channel = new MessageChannel();
const port = wrapNativePort(channel.port1);
```

### Testing

Use `createPortStreamPair` for testing:

```typescript
import { createPortStreamPair } from "@statewalker/vcs-utils";

const [stream1, stream2] = createPortStreamPair();
// stream1 and stream2 are connected via MessageChannel
```
