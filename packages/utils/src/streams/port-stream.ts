/**
 * MessagePort-based binary stream with ACK-based backpressure.
 *
 * This module provides bidirectional streaming over MessagePort with proper
 * flow control. Each sent block requires acknowledgment from the receiver
 * before the next block is sent, preventing memory exhaustion when the
 * receiver is slower than the sender.
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
 *
 * Based on principles from @statewalker/webrun-ports library.
 *
 * @example
 * ```typescript
 * // Create a channel
 * const channel = new MessageChannel();
 *
 * // Sender side
 * const sender = createPortSender(channel.port1);
 * await sender.send(dataStream);
 *
 * // Receiver side
 * const receiver = createPortReceiver(channel.port2);
 * for await (const block of receiver.receive()) {
 *   await processBlock(block);
 * }
 * ```
 */

import { newAsyncGenerator } from "./new-async-generator.js";
import { toChunks } from "./to-chunks.js";

/**
 * Message type constants for the binary protocol.
 */
const MessageType = {
  DATA: 0,
  ACK: 1,
  END: 2,
  ERROR: 3,
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
 * Send a binary stream over MessagePort with ACK-based backpressure.
 *
 * Each block is sent and waits for acknowledgment before sending the next.
 * This ensures the receiver controls the flow rate.
 *
 * @param port MessagePort to send over
 * @param stream Binary stream to send
 * @param options Configuration options
 * @throws Error if receiver closes or ACK timeout occurs
 */
export async function sendPortStream(
  port: MessagePort,
  stream: AsyncIterable<Uint8Array>,
  options: PortStreamOptions = {},
): Promise<void> {
  const { ackTimeout = DEFAULT_ACK_TIMEOUT, chunkSize } = options;

  // Apply chunking if specified
  const chunkedStream = chunkSize ? toChunks(stream, chunkSize) : stream;

  let blockId = 0;
  let currentTimer: ReturnType<typeof setTimeout> | null = null;
  let currentResolve: ((handled: boolean) => void) | null = null;

  // Handle ACK messages
  const handleMessage = (event: MessageEvent<ArrayBuffer | Uint8Array>) => {
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
        // Payload byte: 1=handled, 0=not handled
        const handled = msg.payload.length > 0 && msg.payload[0] === 1;
        resolve(handled);
      }
    } catch {
      // Ignore malformed messages
    }
  };

  port.addEventListener("message", handleMessage);
  port.start();

  try {
    for await (const block of chunkedStream) {
      const id = blockId++;

      // Send block and wait for ACK
      const handled = await new Promise<boolean>((resolve, reject) => {
        currentTimer = setTimeout(() => {
          currentTimer = null;
          currentResolve = null;
          reject(new Error(`ACK timeout for block ${id}`));
        }, ackTimeout);

        currentResolve = resolve;

        // Create message: DATA type with block as payload
        const message = encodeMessage(MessageType.DATA, id, block);

        // Transfer the buffer for efficiency
        const buffer = message.buffer.slice(
          message.byteOffset,
          message.byteOffset + message.byteLength,
        ) as ArrayBuffer;
        port.postMessage(buffer, [buffer]);
      });

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
    port.removeEventListener("message", handleMessage);
    if (currentTimer) {
      clearTimeout(currentTimer);
    }
  }
}

/**
 * Receive a binary stream from MessagePort with ACK-based backpressure.
 *
 * Uses newAsyncGenerator to create proper backpressure - the sender only
 * receives ACK after the consumer processes each block.
 *
 * @param port MessagePort to receive from
 * @returns AsyncIterable yielding received binary blocks
 */
export function receivePortStream(port: MessagePort): AsyncIterable<Uint8Array> {
  return newAsyncGenerator<Uint8Array>((next, done) => {
    const handleMessage = async (event: MessageEvent<ArrayBuffer | Uint8Array>) => {
      const rawData = event.data;
      if (!rawData) return;

      const data = rawData instanceof ArrayBuffer ? new Uint8Array(rawData) : rawData;
      if (data.length < 5) return;

      try {
        const msg = decodeMessage(data);

        switch (msg.type) {
          case MessageType.DATA: {
            // Wait for consumer to process before sending ACK
            // This is the key to backpressure - sender blocks until ACK
            const handled = await next(msg.payload);

            // Send ACK with handled status
            const ackPayload = new Uint8Array([handled ? 1 : 0]);
            const ackMessage = encodeMessage(MessageType.ACK, msg.id, ackPayload);
            port.postMessage(ackMessage.buffer.slice(0) as ArrayBuffer);
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

    port.addEventListener("message", handleMessage);
    port.start();

    // Cleanup function
    return () => {
      port.removeEventListener("message", handleMessage);
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
 * Create a bidirectional stream over a MessagePort.
 *
 * @param port MessagePort for communication
 * @param options Configuration options
 * @returns PortStream interface for bidirectional communication
 */
export function createPortStream(port: MessagePort, options: PortStreamOptions = {}): PortStream {
  return {
    send: (stream) => sendPortStream(port, stream, options),
    receive: () => receivePortStream(port),
    close: () => port.close(),
  };
}

/**
 * Create a pair of connected PortStreams for testing or in-process communication.
 *
 * @param options Configuration options
 * @returns Tuple of two connected PortStream instances
 */
export function createPortStreamPair(options: PortStreamOptions = {}): [PortStream, PortStream] {
  const channel = new MessageChannel();
  return [createPortStream(channel.port1, options), createPortStream(channel.port2, options)];
}
