/**
 * MessagePort-based binary stream with sub-stream ACK-based backpressure.
 *
 * This module provides bidirectional streaming over MessagePort with proper
 * flow control. Blocks are sent in batches (sub-streams), and acknowledgment
 * is requested after each sub-stream completes. This reduces round-trip
 * overhead while still preventing memory exhaustion.
 *
 * Binary Protocol Format:
 * Each message is a Uint8Array with the structure:
 *   [type: 1 byte][id: 4 bytes (big-endian)][payload: variable]
 *
 * Message types:
 *   - DATA (0): payload is the binary block to transfer
 *   - ACK (1): payload is 1 byte (1=handled, 0=not handled)
 *   - END (2): no payload
 *   - ERROR (3): payload is JSON-encoded error message
 *   - STREAM_ACK (4): request ACK after sub-stream (no payload)
 *
 * Sub-stream Flow:
 *   1. Sender sends DATA[0], DATA[1], ..., DATA[N-1] (subStreamSize blocks)
 *   2. Sender sends STREAM_ACK request
 *   3. Receiver processes all DATA blocks and sends ACK
 *   4. Sender continues with next sub-stream
 *
 * Based on principles from @statewalker/webrun-ports library.
 *
 * @example
 * ```typescript
 * // Create a channel
 * const channel = new MessageChannel();
 *
 * // Sender side with sub-stream batching
 * const stream1 = createPortStream(wrapNativePort(channel.port1), {
 *   subStreamSize: 10, // Send 10 blocks before waiting for ACK
 * });
 * await stream1.send(dataStream);
 *
 * // Receiver side
 * const stream2 = createPortStream(wrapNativePort(channel.port2));
 * for await (const block of stream2.receive()) {
 *   await processBlock(block);
 * }
 * ```
 */

import { newAsyncGenerator } from "./new-async-generator.js";
import { toChunks } from "./to-chunks.js";

/**
 * Minimal MessagePort-like interface for transport abstraction.
 *
 * Implementations can wrap PeerJS DataConnection, WebRTC RTCDataChannel,
 * WebSocket, or native MessagePort.
 */
export interface MessagePortLike {
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

/**
 * Message type constants for the binary protocol.
 */
const MessageType = {
  DATA: 0,
  ACK: 1,
  END: 2,
  ERROR: 3,
  STREAM_ACK: 4,
} as const;

type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

/**
 * Options for port stream operations.
 */
export interface PortStreamOptions {
  /** Timeout for ACK response in milliseconds (default: 30000) */
  ackTimeout?: number;
  /** Chunk size for splitting the stream in bytes (default: no chunking) */
  chunkSize?: number;
  /**
   * Number of blocks per sub-stream before requesting ACK (default: 1).
   * When > 1, multiple blocks are sent before waiting for acknowledgment,
   * reducing round-trip overhead at the cost of more receiver-side buffering.
   */
  subStreamSize?: number;
}

const DEFAULT_ACK_TIMEOUT = 30000;

/**
 * Encode a message to binary format.
 * Format: [type: 1 byte][id: 4 bytes big-endian][payload]
 */
function encodeMessage(type: MessageTypeValue, id: number, payload?: Uint8Array): Uint8Array {
  const payloadLength = payload?.length ?? 0;
  const message = new Uint8Array(5 + payloadLength);

  // Type (1 byte)
  message[0] = type;

  // ID (4 bytes, big-endian)
  message[1] = (id >>> 24) & 0xff;
  message[2] = (id >>> 16) & 0xff;
  message[3] = (id >>> 8) & 0xff;
  message[4] = id & 0xff;

  // Payload
  if (payload && payloadLength > 0) {
    message.set(payload, 5);
  }

  return message;
}

/**
 * Decode a binary message.
 * Returns: { type, id, payload }
 */
function decodeMessage(data: Uint8Array): {
  type: MessageTypeValue;
  id: number;
  payload: Uint8Array;
} {
  if (data.length < 5) {
    throw new Error("Invalid message: too short");
  }

  const type = data[0] as MessageTypeValue;
  const id = ((data[1] << 24) | (data[2] << 16) | (data[3] << 8) | data[4]) >>> 0;
  const payload = data.subarray(5);

  return { type, id, payload };
}

/**
 * Send a binary stream over MessagePortLike with sub-stream ACK-based backpressure.
 *
 * Blocks are sent in batches (sub-streams). After each sub-stream, a STREAM_ACK
 * request is sent and the sender waits for acknowledgment before proceeding.
 * This reduces round-trip overhead compared to per-block ACKs.
 *
 * @param port MessagePortLike to send over (MessagePort, WebSocket adapter, etc.)
 * @param stream Binary stream to send
 * @param options Configuration options
 * @throws Error if receiver closes, ACK timeout occurs, or port closes/errors
 */
export async function sendPortStream(
  port: MessagePortLike,
  stream: AsyncIterable<Uint8Array>,
  options: PortStreamOptions = {},
): Promise<void> {
  const { ackTimeout = DEFAULT_ACK_TIMEOUT, chunkSize, subStreamSize = 1 } = options;

  // Apply chunking if specified
  const chunkedStream = chunkSize ? toChunks(stream, chunkSize) : stream;

  let blockId = 0;
  let streamId = 0;
  let currentTimer: ReturnType<typeof setTimeout> | null = null;
  let currentResolve: ((handled: boolean) => void) | null = null;
  let currentReject: ((error: Error) => void) | null = null;
  let portClosed = false;

  // Save previous handlers to restore later
  const previousHandler = port.onmessage;
  const previousCloseHandler = port.onclose;
  const previousErrorHandler = port.onerror;

  // Handle ACK messages
  port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    const rawData = event.data;
    if (!rawData) return;

    const data = rawData instanceof ArrayBuffer ? new Uint8Array(rawData) : rawData;
    if (data.length < 5) return;

    try {
      const msg = decodeMessage(data);
      if (msg.type === MessageType.ACK && currentResolve) {
        if (currentTimer) {
          clearTimeout(currentTimer);
          currentTimer = null;
        }
        const resolve = currentResolve;
        currentResolve = null;
        currentReject = null;
        // Payload byte: 1=handled, 0=not handled
        const handled = msg.payload.length > 0 && msg.payload[0] === 1;
        resolve(handled);
      }
    } catch {
      // Ignore malformed messages
    }
  };

  // Handle port closure during ACK wait
  port.onclose = () => {
    portClosed = true;
    if (currentReject) {
      if (currentTimer) {
        clearTimeout(currentTimer);
        currentTimer = null;
      }
      const reject = currentReject;
      currentResolve = null;
      currentReject = null;
      reject(new Error("Port closed during ACK wait"));
    }
    previousCloseHandler?.();
  };

  // Handle port errors during ACK wait
  port.onerror = (error: Error) => {
    if (currentReject) {
      if (currentTimer) {
        clearTimeout(currentTimer);
        currentTimer = null;
      }
      const reject = currentReject;
      currentResolve = null;
      currentReject = null;
      reject(new Error(`Port error during ACK wait: ${error.message}`));
    }
    previousErrorHandler?.(error);
  };

  port.start();

  // Helper to wait for ACK with timeout
  const waitForAck = (id: number): Promise<boolean> => {
    return new Promise<boolean>((resolve, reject) => {
      if (portClosed) {
        reject(new Error("Port closed during ACK wait"));
        return;
      }

      currentTimer = setTimeout(() => {
        currentTimer = null;
        currentResolve = null;
        currentReject = null;
        reject(new Error(`ACK timeout for sub-stream ${id}`));
      }, ackTimeout);

      currentResolve = resolve;
      currentReject = reject;
    });
  };

  try {
    let blocksInSubStream = 0;

    for await (const block of chunkedStream) {
      if (portClosed) {
        throw new Error("Port closed during send");
      }

      const id = blockId++;

      // Send DATA message
      const message = encodeMessage(MessageType.DATA, id, block);
      const buffer = message.buffer.slice(
        message.byteOffset,
        message.byteOffset + message.byteLength,
      ) as ArrayBuffer;
      port.postMessage(buffer);

      blocksInSubStream++;

      // Request ACK after subStreamSize blocks
      if (blocksInSubStream >= subStreamSize) {
        // Send STREAM_ACK request
        const ackReqMessage = encodeMessage(MessageType.STREAM_ACK, streamId);
        port.postMessage(ackReqMessage.buffer.slice(0) as ArrayBuffer);

        const handled = await waitForAck(streamId);
        if (!handled) {
          throw new Error("Receiver closed the stream");
        }

        streamId++;
        blocksInSubStream = 0;
      }
    }

    // Send ACK request for remaining blocks in last sub-stream
    if (blocksInSubStream > 0) {
      const ackReqMessage = encodeMessage(MessageType.STREAM_ACK, streamId);
      port.postMessage(ackReqMessage.buffer.slice(0) as ArrayBuffer);

      const handled = await waitForAck(streamId);
      if (!handled) {
        throw new Error("Receiver closed the stream");
      }
    }

    // Signal completion
    const endMessage = encodeMessage(MessageType.END, blockId);
    port.postMessage(endMessage.buffer.slice(0) as ArrayBuffer);
  } catch (error) {
    // Signal error to receiver
    const errorJson = JSON.stringify(error instanceof Error ? error.message : String(error));
    const errorPayload = new TextEncoder().encode(errorJson);
    const errorMessage = encodeMessage(MessageType.ERROR, blockId, errorPayload);
    port.postMessage(errorMessage.buffer.slice(0) as ArrayBuffer);
    throw error;
  } finally {
    port.onmessage = previousHandler;
    port.onclose = previousCloseHandler;
    port.onerror = previousErrorHandler;
    if (currentTimer) {
      clearTimeout(currentTimer);
    }
  }
}

/**
 * Receive a binary stream from MessagePortLike with sub-stream ACK-based backpressure.
 *
 * Uses newAsyncGenerator to create proper backpressure. ACKs are sent only when
 * STREAM_ACK requests are received, not for individual DATA blocks.
 *
 * @param port MessagePortLike to receive from (MessagePort, WebSocket adapter, etc.)
 * @returns AsyncIterable yielding received binary blocks
 */
export function receivePortStream(port: MessagePortLike): AsyncIterable<Uint8Array> {
  return newAsyncGenerator<Uint8Array>((next, done) => {
    // Save previous handler to restore on cleanup
    const previousHandler = port.onmessage;

    // Track cumulative handled status for the current sub-stream
    let handled = true;

    port.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
      const rawData = event.data;
      if (!rawData) return;

      const data = rawData instanceof ArrayBuffer ? new Uint8Array(rawData) : rawData;
      if (data.length < 5) return;

      try {
        const msg = decodeMessage(data);

        switch (msg.type) {
          case MessageType.DATA: {
            // Process block and track handled status
            // If any block in the sub-stream fails, the whole sub-stream is marked as not handled
            const blockHandled = await next(msg.payload);
            handled = handled && blockHandled;
            break;
          }
          case MessageType.STREAM_ACK: {
            // Send ACK with cumulative handled status for the sub-stream
            const ackPayload = new Uint8Array([handled ? 1 : 0]);
            const ackMessage = encodeMessage(MessageType.ACK, msg.id, ackPayload);
            port.postMessage(ackMessage.buffer.slice(0) as ArrayBuffer);
            // Reset for next sub-stream
            handled = true;
            break;
          }
          case MessageType.END: {
            await done();
            break;
          }
          case MessageType.ERROR: {
            // Decode error from JSON payload
            const errorJson = new TextDecoder().decode(msg.payload);
            const errorMessage = JSON.parse(errorJson);
            await done(new Error(errorMessage));
            break;
          }
        }
      } catch (err) {
        // Handle decoding errors
        await done(err instanceof Error ? err : new Error(String(err)));
      }
    };

    port.start();

    // Cleanup function
    return () => {
      port.onmessage = previousHandler;
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
   * Blocks until each chunk is acknowledged.
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
    send: (stream) => sendPortStream(port, stream, options),
    receive: () => receivePortStream(port),
    close: () => port.close(),
  };
}

/**
 * Wrap a native MessagePort as MessagePortLike.
 *
 * @param port Native MessagePort to wrap
 * @returns MessagePortLike adapter
 */
export function wrapNativePort(port: MessagePort): MessagePortLike {
  let started = false;
  const wrapper: MessagePortLike = {
    onmessage: null,
    onerror: null,
    onclose: null,

    get isOpen() {
      // MessagePort doesn't have a direct isOpen property
      // We assume it's open once started (until explicitly closed)
      return started;
    },

    postMessage(data: ArrayBuffer | Uint8Array) {
      const buffer =
        data instanceof ArrayBuffer
          ? data
          : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      port.postMessage(buffer, [buffer]);
    },

    close() {
      port.close();
    },

    start() {
      if (started) return;
      started = true;
      port.onmessage = (e) => wrapper.onmessage?.(e as MessageEvent<ArrayBuffer>);
      port.onmessageerror = () => wrapper.onerror?.(new Error("Message deserialization error"));
      port.start();
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
