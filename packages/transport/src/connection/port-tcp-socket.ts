/**
 * TcpSocket implementation over MessagePortLike.
 *
 * Implements the TcpSocket interface using the binary protocol from port-stream
 * for ACK-based backpressure. This enables git:// protocol over browser-compatible
 * transports like WebRTC, WebSocket, and PeerJS.
 *
 * The implementation directly uses the binary protocol (9-byte header) rather than
 * the high-level writeStream/readStream functions, because TcpSocket.write() is
 * called per-chunk rather than passing an async iterable.
 */

import type { MessagePortLike, PortStreamOptions } from "@statewalker/vcs-utils";
import type { TcpSocket } from "./git-connection.js";

/**
 * Message type constants for the binary protocol.
 * Must match the values in port-stream.ts.
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

const DEFAULT_CHUNK_SIZE = 64 * 1024;
const DEFAULT_ACK_TIMEOUT = 5000;

/**
 * Options for creating a PortTcpSocket.
 */
export interface PortTcpSocketOptions extends PortStreamOptions {
  /** Byte threshold for requesting ACK (default: 64KB) */
  chunkSize?: number;
  /** Timeout for ACK response in milliseconds (default: 5000) */
  ackTimeout?: number;
}

/**
 * TcpSocket implementation using MessagePortLike and binary protocol.
 *
 * Provides the TcpSocket interface expected by GitConnection, enabling
 * git:// protocol over any MessagePortLike transport.
 */
export class PortTcpSocket implements TcpSocket {
  private readonly port: MessagePortLike;
  private readonly chunkSize: number;
  private readonly ackTimeout: number;
  private messageId = 0;
  private bytesSinceAck = 0;
  private connected = false;
  private closed = false;

  constructor(port: MessagePortLike, options: PortTcpSocketOptions = {}) {
    this.port = port;
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.ackTimeout = options.ackTimeout ?? DEFAULT_ACK_TIMEOUT;
  }

  /**
   * Connect the socket.
   * Starts the port to begin receiving messages.
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.closed) throw new Error("Socket is closed");

    this.port.start();
    this.connected = true;
  }

  /**
   * Write data to the socket.
   *
   * Sends DATA message immediately. After chunkSize bytes have been sent,
   * requests ACK and waits for acknowledgment before returning.
   */
  async write(data: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("Socket is closed");
    if (!this.connected) throw new Error("Socket not connected");

    // Send DATA message
    const message = encode(MessageType.DATA, this.messageId++, data);
    this.port.postMessage(message);
    this.bytesSinceAck += data.length;

    // Request ACK if threshold reached
    if (this.bytesSinceAck >= this.chunkSize) {
      await this.requestAck();
      this.bytesSinceAck = 0;
    }
  }

  /**
   * Read data from the socket.
   *
   * Returns an async iterable that yields received data blocks.
   * Handles REQUEST_ACK messages by sending ACKNOWLEDGE responses.
   */
  read(): AsyncIterable<Uint8Array> {
    const port = this.port;

    return {
      [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        const queue: Uint8Array[] = [];
        const waiters: Array<{
          resolve: (result: IteratorResult<Uint8Array>) => void;
          reject: (error: Error) => void;
        }> = [];
        let done = false;
        let error: Error | null = null;

        function onMessage(event: MessageEvent<ArrayBuffer>) {
          try {
            const msg = decode(event.data);

            switch (msg.type) {
              case MessageType.DATA: {
                if (msg.data) {
                  const waiter = waiters.shift();
                  if (waiter) {
                    waiter.resolve({ value: msg.data, done: false });
                  } else {
                    queue.push(msg.data);
                  }
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
                done = true;
                port.removeEventListener("message", onMessage);
                // Resolve all pending waiters
                for (const waiter of waiters.splice(0)) {
                  waiter.resolve({ value: undefined, done: true });
                }
                break;
              }
            }
          } catch (err) {
            error = err instanceof Error ? err : new Error(String(err));
            done = true;
            for (const waiter of waiters.splice(0)) {
              waiter.reject(error);
            }
          }
        }

        function onClose() {
          done = true;
          port.removeEventListener("message", onMessage);
          port.removeEventListener("close", onClose);
          for (const waiter of waiters.splice(0)) {
            waiter.resolve({ value: undefined, done: true });
          }
        }

        port.addEventListener("message", onMessage);
        port.addEventListener("close", onClose);

        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            if (error) {
              throw error;
            }
            const queued = queue.shift();
            if (queued) {
              return { value: queued, done: false };
            }
            if (done) {
              return { value: undefined, done: true };
            }

            return new Promise((resolve, reject) => {
              waiters.push({ resolve, reject });
            });
          },

          async return(): Promise<IteratorResult<Uint8Array>> {
            done = true;
            port.removeEventListener("message", onMessage);
            port.removeEventListener("close", onClose);
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  /**
   * Close the socket.
   *
   * Sends END message and closes the port.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.connected) {
      // Request final ACK if there's pending data
      if (this.bytesSinceAck > 0) {
        try {
          await this.requestAck();
        } catch {
          // Ignore ACK timeout on close - peer may have already closed
        }
      }

      // Send END message
      const endMessage = encode(MessageType.END, this.messageId++);
      this.port.postMessage(endMessage);
    }

    this.port.close();
  }

  /**
   * Send REQUEST_ACK and wait for ACKNOWLEDGE response.
   */
  private requestAck(): Promise<void> {
    return new Promise((resolve, reject) => {
      const currentId = this.messageId++;
      const message = encode(MessageType.REQUEST_ACK, currentId);

      const timerId = setTimeout(() => {
        this.port.removeEventListener("message", onMessage);
        reject(new Error("Timeout waiting for acknowledgement"));
      }, this.ackTimeout);

      const onMessage = (event: MessageEvent<ArrayBuffer>) => {
        try {
          const msg = decode(event.data);
          if (msg.type === MessageType.ACKNOWLEDGE && msg.id === currentId) {
            clearTimeout(timerId);
            this.port.removeEventListener("message", onMessage);
            resolve();
          }
        } catch {
          // Ignore decode errors - not our message
        }
      };

      this.port.addEventListener("message", onMessage);
      this.port.postMessage(message);
    });
  }
}

/**
 * Create a TcpSocket from a MessagePortLike.
 *
 * This factory function creates a TcpSocket implementation that uses
 * the binary protocol for ACK-based backpressure over MessagePortLike.
 *
 * @param port MessagePortLike to use for communication
 * @param options Configuration options
 * @returns TcpSocket implementation
 *
 * @example
 * ```typescript
 * import { createPortTcpSocket } from "@statewalker/vcs-transport";
 * import { wrapWebSocket } from "@statewalker/vcs-port-websocket";
 *
 * const ws = new WebSocket("ws://proxy:8080");
 * const port = wrapWebSocket(ws);
 * const socket = createPortTcpSocket(port);
 *
 * await socket.connect();
 * await socket.write(new TextEncoder().encode("git-upload-pack /repo\0host=github.com\0"));
 *
 * for await (const chunk of socket.read()) {
 *   console.log("Received:", chunk);
 * }
 *
 * await socket.close();
 * ```
 */
export function createPortTcpSocket(
  port: MessagePortLike,
  options?: PortTcpSocketOptions,
): TcpSocket {
  return new PortTcpSocket(port, options);
}
