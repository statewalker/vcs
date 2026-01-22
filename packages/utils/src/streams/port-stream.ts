/**
 * MessagePort-based binary stream with byte-based sub-stream ACK backpressure.
 *
 * This module provides bidirectional streaming over MessagePort with proper
 * flow control. Blocks are sent until chunkSize bytes are reached, then
 * acknowledgment is requested before continuing. This reduces round-trip
 * overhead while still preventing memory exhaustion.
 *
 * Binary Protocol Format (9-byte header):
 *   [type: 1 byte][id: 4 bytes LE][length: 4 bytes LE][payload: variable]
 *
 * Message types:
 *   - REQUEST_ACK (1): Request acknowledgment from receiver
 *   - ACKNOWLEDGE (2): Acknowledgment response
 *   - DATA (3): Binary data block
 *   - END (4): Stream complete
 *
 * Flow:
 *   1. Sender sends DATA blocks until chunkSize bytes reached
 *   2. Sender sends REQUEST_ACK
 *   3. Receiver responds with ACKNOWLEDGE
 *   4. Sender continues with next sub-stream
 *   5. Sender sends END when complete
 *
 * Based on principles from @statewalker/webrun-ports library.
 *
 * @example
 * ```typescript
 * const channel = new MessageChannel();
 * const port1 = wrapNativePort(channel.port1);
 * const port2 = wrapNativePort(channel.port2);
 *
 * // Sender side
 * await writeStream(port1, dataStream, { chunkSize: 64 * 1024 });
 *
 * // Receiver side
 * for await (const block of readStream(port2)) {
 *   await processBlock(block);
 * }
 * ```
 */

import { newAsyncGenerator } from "./new-async-generator.js";
import { splitStream } from "./split-stream.js";

/**
 * Event listener types for MessagePortLike.
 */
export type MessagePortEventType = "message" | "close" | "error";

/**
 * Event listener type mapping for MessagePortLike.
 */
export type MessagePortEventListener<T extends MessagePortEventType> = T extends "message"
  ? (event: MessageEvent<ArrayBuffer>) => void
  : T extends "error"
    ? (error: Error) => void
    : () => void;

/**
 * Minimal MessagePort-like interface for transport abstraction.
 *
 * Follows the MessagePort API specification with additional "close" and "error" events.
 * Implementations can wrap PeerJS DataConnection, WebRTC RTCDataChannel,
 * WebSocket, or native MessagePort.
 */
export interface MessagePortLike {
  /** Post binary data to the remote endpoint */
  postMessage(data: ArrayBuffer | Uint8Array): void;

  /** Close the port */
  close(): void;

  /** Start receiving messages (required by MessagePort spec) */
  start(): void;

  /** Add event listener */
  addEventListener<T extends MessagePortEventType>(
    type: T,
    listener: MessagePortEventListener<T>,
  ): void;

  /** Remove event listener */
  removeEventListener<T extends MessagePortEventType>(
    type: T,
    listener: MessagePortEventListener<T>,
  ): void;
}

/**
 * Message type constants for the binary protocol.
 */
const MessageType = {
  REQUEST_ACK: 1,
  ACKNOWLEDGE: 2,
  DATA: 3,
  END: 4,
} as const;

type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

/**
 * Encode a message to binary format.
 * Format: [type: 1 byte][id: 4 bytes LE][length: 4 bytes LE][payload]
 */
function encode(type: MessageTypeValue, id: number, data?: Uint8Array): ArrayBuffer {
  const length = data ? data.length : 0;
  const buffer = new ArrayBuffer(1 + 4 + 4 + length);
  const view = new DataView(buffer);
  view.setUint8(0, type);
  view.setUint32(1, id, true); // little-endian
  view.setUint32(5, length, true); // little-endian
  if (data && length > 0) {
    new Uint8Array(buffer, 9).set(data);
  }
  return buffer;
}

/**
 * Decode a message from binary format.
 * Returns: { type, id, data }
 */
function decode(buffer: ArrayBuffer): { type: MessageTypeValue; id: number; data?: Uint8Array } {
  if (buffer.byteLength < 9) {
    throw new Error("Invalid message: too short (need at least 9 bytes)");
  }
  const view = new DataView(buffer);
  const type = view.getUint8(0) as MessageTypeValue;
  const id = view.getUint32(1, true);
  const length = view.getUint32(5, true);
  let data: Uint8Array | undefined;
  if (length > 0) {
    if (buffer.byteLength < 9 + length) {
      throw new Error(`Invalid message: expected ${9 + length} bytes but got ${buffer.byteLength}`);
    }
    data = new Uint8Array(buffer, 9, length);
  }
  return { type, id, data };
}

/**
 * Options for writeStream/readStream operations.
 */
export interface PortStreamOptions {
  /** Byte threshold for sub-stream splitting (default: 64KB) */
  chunkSize?: number;
  /** Timeout for ACK response in milliseconds (default: 5000) */
  ackTimeout?: number;
}

const DEFAULT_CHUNK_SIZE = 64 * 1024;
const DEFAULT_ACK_TIMEOUT = 5000;

/**
 * Create a function that awaits ACK responses from the receiver.
 *
 * Uses addEventListener to allow multiple pending ACK requests.
 * Each call sends a REQUEST_ACK message and waits for matching ACKNOWLEDGE.
 *
 * @param port MessagePortLike for communication
 * @param options Configuration options
 * @returns Function that sends REQUEST_ACK and waits for ACKNOWLEDGE
 */
export function createAwaitAckFunction(
  port: MessagePortLike,
  options: { ackTimeout?: number } = {},
): () => Promise<void> {
  const timeout = options.ackTimeout ?? DEFAULT_ACK_TIMEOUT;
  let messageId = 0;

  return async function awaitAck(): Promise<void> {
    const currentId = messageId++;

    return new Promise((resolve, reject) => {
      const encodedMessage = encode(MessageType.REQUEST_ACK, currentId);
      port.postMessage(encodedMessage);

      const timerId = setTimeout(() => {
        port.removeEventListener("message", onMessage);
        reject(new Error("Timeout waiting for acknowledgement"));
      }, timeout);

      function onMessage(event: MessageEvent<ArrayBuffer>) {
        const decoded = decode(event.data);
        if (decoded.type !== MessageType.ACKNOWLEDGE || decoded.id !== currentId) {
          return;
        }
        clearTimeout(timerId);
        port.removeEventListener("message", onMessage);
        resolve();
      }

      port.addEventListener("message", onMessage);
    });
  };
}

/**
 * Transform a stream by splitting into byte-based sub-streams and awaiting ACK between them.
 *
 * @param stream Input binary stream
 * @param awaitAck Function to await ACK from receiver
 * @param options Configuration options
 * @yields Binary chunks with ACK awaited between sub-streams
 */
export async function* sendWithAcknowledgement(
  stream: AsyncIterable<Uint8Array>,
  awaitAck: () => Promise<void>,
  options: { chunkSize?: number } = {},
): AsyncGenerator<Uint8Array> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  let loadedSize = 0;

  const streamOfStreams = splitStream(stream, (block) => {
    const pos = Math.min(chunkSize, loadedSize + block.length) - loadedSize;
    if (pos < block.length) {
      loadedSize = 0;
      return pos;
    }
    loadedSize += block.length;
    return -1;
  });

  let isFirst = true;
  for await (const substream of streamOfStreams) {
    if (!isFirst) {
      await awaitAck();
    }
    isFirst = false;
    for await (const chunk of substream) {
      yield chunk;
    }
  }
}

/**
 * Write a binary stream to MessagePort with ACK-based backpressure.
 *
 * Uses byte-based sub-stream splitting: after chunkSize bytes are sent,
 * waits for ACK before continuing.
 *
 * @param port MessagePortLike for communication
 * @param stream Binary stream to send
 * @param options Configuration options
 */
export async function writeStream(
  port: MessagePortLike,
  stream: AsyncIterable<Uint8Array>,
  options: PortStreamOptions = {},
): Promise<void> {
  const awaitAck = createAwaitAckFunction(port, { ackTimeout: options.ackTimeout });
  let messageId = 0;

  port.start();

  const acknowledgedStream = sendWithAcknowledgement(stream, awaitAck, {
    chunkSize: options.chunkSize,
  });

  for await (const chunk of acknowledgedStream) {
    const encodedMessage = encode(MessageType.DATA, messageId++, chunk);
    port.postMessage(encodedMessage);
  }

  // Final ACK before END to ensure all data processed
  await awaitAck();

  // Signal completion
  const endMessage = encode(MessageType.END, messageId);
  port.postMessage(endMessage);
}

/**
 * Read a binary stream from MessagePort, responding to ACK requests.
 *
 * @param port MessagePortLike for communication
 * @returns AsyncIterable yielding received binary blocks
 */
export function readStream(port: MessagePortLike): AsyncIterable<Uint8Array> {
  return newAsyncGenerator<Uint8Array>((next, done) => {
    async function onMessage(event: MessageEvent<ArrayBuffer>) {
      try {
        const msg = decode(event.data);

        switch (msg.type) {
          case MessageType.DATA: {
            if (msg.data) {
              await next(msg.data);
            }
            break;
          }
          case MessageType.REQUEST_ACK: {
            // Send acknowledgment back
            const ackMessage = encode(MessageType.ACKNOWLEDGE, msg.id);
            port.postMessage(ackMessage);
            break;
          }
          case MessageType.END: {
            await done();
            break;
          }
        }
      } catch (err) {
        await done(err instanceof Error ? err : new Error(String(err)));
      }
    }

    port.addEventListener("message", onMessage);
    port.start();

    // Cleanup function
    return () => {
      port.removeEventListener("message", onMessage);
    };
  });
}

/**
 * Bidirectional port stream for request/response patterns.
 *
 * Combines sending and receiving capabilities over a single port.
 */
export interface PortStream {
  /**
   * Send a binary stream to the peer.
   * Blocks until each sub-stream (chunkSize bytes) is acknowledged.
   */
  send(stream: AsyncIterable<Uint8Array>): Promise<void>;

  /**
   * Receive a binary stream from the peer.
   * Returns an async iterable with proper backpressure.
   */
  receive(): AsyncIterable<Uint8Array>;

  /**
   * Close the port and cleanup resources.
   */
  close(): void;
}

/**
 * Create a bidirectional stream over a MessagePortLike.
 *
 * @param port MessagePortLike for communication (MessagePort, WebSocket adapter, etc.)
 * @param options Configuration options
 * @returns PortStream interface for bidirectional communication
 */
export function createPortStream(
  port: MessagePortLike,
  options: PortStreamOptions = {},
): PortStream {
  return {
    send: (stream) => writeStream(port, stream, options),
    receive: () => readStream(port),
    close: () => port.close(),
  };
}

/**
 * Wrap a native MessagePort as MessagePortLike.
 *
 * Note: Native MessagePort doesn't have close/error events, so these are
 * emulated. Close listeners are called when close() is invoked.
 *
 * @param port Native MessagePort to wrap
 * @returns MessagePortLike adapter
 */
export function wrapNativePort(port: MessagePort): MessagePortLike {
  let started = false;
  const closeListeners = new Set<() => void>();
  const errorListeners = new Set<(error: Error) => void>();

  const wrapper: MessagePortLike = {
    postMessage(data: ArrayBuffer | Uint8Array) {
      const buffer =
        data instanceof ArrayBuffer
          ? data
          : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      port.postMessage(buffer, [buffer]);
    },

    close() {
      port.close();
      for (const listener of closeListeners) {
        listener();
      }
    },

    start() {
      if (started) return;
      started = true;
      port.start();
    },

    addEventListener<T extends MessagePortEventType>(
      type: T,
      listener: MessagePortEventListener<T>,
    ) {
      if (type === "message") {
        port.addEventListener(type, listener as EventListener);
      } else if (type === "close") {
        closeListeners.add(listener as () => void);
      } else if (type === "error") {
        errorListeners.add(listener as (error: Error) => void);
      }
    },

    removeEventListener<T extends MessagePortEventType>(
      type: T,
      listener: MessagePortEventListener<T>,
    ) {
      if (type === "message") {
        port.removeEventListener(type, listener as EventListener);
      } else if (type === "close") {
        closeListeners.delete(listener as () => void);
      } else if (type === "error") {
        errorListeners.delete(listener as (error: Error) => void);
      }
    },
  };
  return wrapper;
}

/**
 * Create a pair of connected PortStreams for testing or in-process communication.
 *
 * @param options Configuration options
 * @returns Tuple of two connected PortStream instances
 */
export function createPortStreamPair(options: PortStreamOptions = {}): [PortStream, PortStream] {
  const channel = new MessageChannel();
  return [
    createPortStream(wrapNativePort(channel.port1), options),
    createPortStream(wrapNativePort(channel.port2), options),
  ];
}
