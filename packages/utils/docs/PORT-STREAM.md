# Port Stream Documentation

## Overview

The port-stream module provides bidirectional streaming over `MessagePortLike` with ACK-based backpressure. This ensures reliable data transfer where the receiver controls the flow rate.

## API Reference

### MessagePortLike Interface

```typescript
interface MessagePortLike {
  /** Post binary data to the remote endpoint */
  postMessage(data: ArrayBuffer | Uint8Array): void;

  /** Handler for incoming binary messages */
  onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null;

  /** Handler for errors */
  onerror: ((error: Error) => void) | null;

  /** Handler for connection close */
  onclose: (() => void) | null;

  /** Close the port */
  close(): void;

  /** Start receiving messages (required by MessagePort spec) */
  start(): void;

  /** Whether the port is currently open */
  readonly isOpen: boolean;
}
```

### createPortStream

Create a bidirectional stream over a MessagePortLike:

```typescript
function createPortStream(
  port: MessagePortLike,
  options?: PortStreamOptions
): PortStream;

interface PortStreamOptions {
  /** Timeout for ACK response in milliseconds (default: 30000) */
  ackTimeout?: number;
  /** Chunk size for splitting the stream in bytes (default: no chunking) */
  chunkSize?: number;
}

interface PortStream {
  /** Send a binary stream with backpressure */
  send(stream: AsyncIterable<Uint8Array>): Promise<void>;

  /** Receive a binary stream with backpressure */
  receive(): AsyncIterable<Uint8Array>;

  /** Close the port */
  close(): void;
}
```

### sendPortStream / receivePortStream

Lower-level functions for one-directional streaming:

```typescript
async function sendPortStream(
  port: MessagePortLike,
  stream: AsyncIterable<Uint8Array>,
  options?: PortStreamOptions
): Promise<void>;

function receivePortStream(
  port: MessagePortLike
): AsyncIterable<Uint8Array>;
```

### wrapNativePort

Wrap a native `MessagePort` as `MessagePortLike`:

```typescript
function wrapNativePort(port: MessagePort): MessagePortLike;
```

### createPortStreamPair

Create a connected pair of PortStreams for testing:

```typescript
function createPortStreamPair(
  options?: PortStreamOptions
): [PortStream, PortStream];
```

## Binary Protocol Specification

### Message Format

Each message is encoded as a `Uint8Array`:

```
┌──────────┬────────────────────┬─────────────────┐
│ Type     │ ID                 │ Payload         │
│ (1 byte) │ (4 bytes BE)       │ (variable)      │
└──────────┴────────────────────┴─────────────────┘
```

### Message Types

| Type | Value | Payload | Description |
|------|-------|---------|-------------|
| DATA | 0 | Binary data | Block to transfer |
| ACK | 1 | 1 byte (0/1) | Acknowledgment |
| END | 2 | (none) | Stream complete |
| ERROR | 3 | JSON string | Error message |

### ACK Payload

- `0x01`: Block handled successfully
- `0x00`: Block rejected (stream closing)

## Backpressure Mechanism

### Flow Diagram

```
Sender                                    Receiver
  │                                          │
  │  ┌────────────────────────┐             │
  │  │ DATA [id=0] [payload]  │─────────────►│
  │  └────────────────────────┘             │
  │                                          │
  │              (Receiver processes data)   │
  │                                          │
  │             ┌──────────────────┐        │
  │◄────────────│ ACK [id=0] [0x01]│        │
  │             └──────────────────┘        │
  │                                          │
  │  ┌────────────────────────┐             │
  │  │ DATA [id=1] [payload]  │─────────────►│
  │  └────────────────────────┘             │
  │              ...                         │
  │  ┌──────────────┐                       │
  │  │ END [id=N]   │───────────────────────►│
  │  └──────────────┘                       │
```

### Key Properties

1. **Flow Control**: Sender waits for ACK before sending next block
2. **Memory Safety**: Prevents buffer overflow on slow receivers
3. **Error Propagation**: Errors are sent via ERROR message type
4. **Timeout Protection**: ACK timeout prevents indefinite blocking

## Usage Examples

### Basic Send/Receive

```typescript
import { createPortStream, wrapNativePort } from "@statewalker/vcs-utils";

// Create channel
const channel = new MessageChannel();
const port1 = wrapNativePort(channel.port1);
const port2 = wrapNativePort(channel.port2);

const stream1 = createPortStream(port1);
const stream2 = createPortStream(port2);

// Send data
async function* generateData() {
  yield new Uint8Array([1, 2, 3]);
  yield new Uint8Array([4, 5, 6]);
}

const sendPromise = stream1.send(generateData());

// Receive data
for await (const chunk of stream2.receive()) {
  console.log("Received:", chunk);
}

await sendPromise;
```

### With Chunking

```typescript
const stream = createPortStream(port, {
  chunkSize: 1024,  // Split large blocks into 1KB chunks
});

// Even if you send a 1MB block, it will be split into 1KB chunks
await stream.send(generateLargeData());
```

### Error Handling

```typescript
try {
  await stream.send(data);
} catch (error) {
  if (error.message.includes("ACK timeout")) {
    console.error("Receiver not responding");
  } else if (error.message.includes("closed")) {
    console.error("Connection closed");
  }
}
```

## Performance Considerations

### Block Size Selection

| Block Size | Overhead | Latency | Use Case |
|------------|----------|---------|----------|
| 1 KB | High | Low | Interactive |
| 64 KB | Medium | Medium | General |
| 256 KB | Low | Higher | Bulk transfer |

### ACK Timeout

- **Short timeout (5s)**: Fast failure detection, may fail on slow networks
- **Default (30s)**: Balanced for most use cases
- **Long timeout (60s+)**: For high-latency networks

### Memory Usage

The backpressure mechanism ensures that at most one block is buffered at the sender while waiting for ACK. The receiver processes blocks one at a time.

## Implementation Notes

### Handler Management

The port stream temporarily overrides `onmessage` during send/receive operations, restoring the previous handler on completion.

### Thread Safety

Port streams are designed for single-threaded use. Do not share a single PortStream between concurrent operations.

### Cleanup

Always close the stream when done to release resources:

```typescript
stream.close();
// or
port.close();
```
