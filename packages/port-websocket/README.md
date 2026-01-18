# @statewalker/vcs-port-websocket

WebSocket adapter for MessagePortLike interface.

## Overview

This package wraps WebSocket connections to provide the `MessagePortLike` interface, enabling use with `createPortStream` or `createPortTransportConnection` for Git protocol communication over WebSocket connections.

## Installation

```bash
npm install @statewalker/vcs-port-websocket
# or
pnpm add @statewalker/vcs-port-websocket
```

## Usage

### Basic Usage with createPortStream

```typescript
import { createWebSocketPortAsync } from "@statewalker/vcs-port-websocket";
import { createPortStream } from "@statewalker/vcs-utils";

// Connect to WebSocket server
const port = await createWebSocketPortAsync("wss://example.com/git");

// Create bidirectional stream with ACK-based backpressure
const stream = createPortStream(port);

// Send binary data
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

### With TransportConnection for Git Protocol

```typescript
import { createWebSocketPortAsync } from "@statewalker/vcs-port-websocket";
import { createPortTransportConnection } from "@statewalker/vcs-transport";

const port = await createWebSocketPortAsync("wss://example.com/git");
const transport = createPortTransportConnection(port);

// Use transport for Git operations
await transport.send(packets);
for await (const packet of transport.receive()) {
  // Handle incoming Git packets
}
```

### From Existing WebSocket

If you have an existing WebSocket instance:

```typescript
import { createWebSocketPort, createWebSocketPortFromOpen } from "@statewalker/vcs-port-websocket";

// From any WebSocket (will set up handlers)
const port1 = createWebSocketPort(ws);

// From already-open WebSocket (throws if not OPEN)
const port2 = createWebSocketPortFromOpen(ws);
```

## API Reference

### createWebSocketPortAsync(url, protocols?)

Connect to a WebSocket server and return a port when connected.

```typescript
function createWebSocketPortAsync(
  url: string,
  protocols?: string | string[]
): Promise<WebSocketPort>;
```

### createWebSocketPort(ws, options?)

Wrap an existing WebSocket as MessagePortLike.

```typescript
function createWebSocketPort(
  ws: WebSocket,
  options?: WebSocketPortOptions
): WebSocketPort;
```

### createWebSocketPortFromOpen(ws, options?)

Wrap an already-open WebSocket. Throws if WebSocket is not in OPEN state.

```typescript
function createWebSocketPortFromOpen(
  ws: WebSocket,
  options?: WebSocketPortOptions
): WebSocketPort;
```

### WebSocketPortOptions

```typescript
interface WebSocketPortOptions {
  /** Binary type for WebSocket. Default: "arraybuffer" */
  binaryType?: BinaryType;
}
```

### WebSocketPort Interface

```typescript
interface WebSocketPort extends MessagePortLike {
  readonly bufferedAmount: number;  // Bytes queued for sending
}
```

## Data Handling

The port automatically handles different WebSocket message types:

| Message Type | Handling |
|--------------|----------|
| ArrayBuffer | Passed directly |
| Blob | Converted to ArrayBuffer |
| String | Encoded as UTF-8 |

## See Also

- [@statewalker/vcs-port-webrtc](../port-webrtc/) - WebRTC peer-to-peer connections
- [@statewalker/vcs-port-peerjs](../port-peerjs/) - PeerJS connections
- [@statewalker/vcs-transport](../transport/) - Transport layer interfaces

## License

MIT
