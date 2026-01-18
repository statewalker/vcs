/**
 * PeerJS DataConnection to TransportConnection adapter.
 *
 * Adapts a PeerJS DataConnection to implement the TransportConnection
 * interface for Git protocol communication over peer-to-peer connections.
 *
 * Features:
 * - Bidirectional packet streaming over DataConnection
 * - Proper message framing for binary data
 * - Backpressure handling via bufferedAmount
 * - Clean resource cleanup
 */

import type { Packet, TransportConnection } from "@statewalker/vcs-transport";
import { pktLineReader, pktLineWriter } from "@statewalker/vcs-transport";
import type { DataConnection } from "peerjs";

/**
 * Options for creating a PeerJS stream.
 */
export interface PeerJsStreamOptions {
  /** High water mark for backpressure (bytes) */
  highWaterMark?: number;
  /** Interval to check bufferedAmount (ms) */
  drainInterval?: number;
}

const DEFAULT_HIGH_WATER_MARK = 64 * 1024; // 64KB
const DEFAULT_DRAIN_INTERVAL = 10; // 10ms

/**
 * Adapter that wraps PeerJS DataConnection as a TransportConnection.
 *
 * The DataConnection must be open before use. Messages are sent/received
 * as binary ArrayBuffers, which are then framed using pkt-line protocol.
 *
 * IMPORTANT: The DataConnection must be created with { serialization: "raw" }
 * for binary data to work correctly.
 */
export class PeerJsStream implements TransportConnection {
  private readonly conn: DataConnection;
  private readonly highWaterMark: number;
  private readonly drainInterval: number;
  private closed = false;

  // Incoming message queue for receive()
  private readonly messageQueue: Uint8Array[] = [];
  private messageResolve: ((value: Uint8Array | null) => void) | null = null;
  private error: Error | null = null;

  constructor(conn: DataConnection, options: PeerJsStreamOptions = {}) {
    this.conn = conn;
    this.highWaterMark = options.highWaterMark ?? DEFAULT_HIGH_WATER_MARK;
    this.drainInterval = options.drainInterval ?? DEFAULT_DRAIN_INTERVAL;

    // Set up message handling
    this.setupHandlers();
  }

  /**
   * Set up DataConnection event handlers.
   */
  private setupHandlers(): void {
    this.conn.on("data", (data: unknown) => {
      if (this.closed) return;

      // Convert to Uint8Array
      let bytes: Uint8Array;
      if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else if (data instanceof Uint8Array) {
        bytes = data;
      } else if (ArrayBuffer.isView(data)) {
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      } else {
        // For string data, encode as UTF-8
        bytes = new TextEncoder().encode(String(data));
      }

      // If someone is waiting for data, resolve immediately
      if (this.messageResolve) {
        const resolve = this.messageResolve;
        this.messageResolve = null;
        resolve(bytes);
      } else {
        // Otherwise queue it
        this.messageQueue.push(bytes);
      }
    });

    this.conn.on("error", (err: Error) => {
      this.error = err;
      this.handleClose();
    });

    this.conn.on("close", () => {
      this.handleClose();
    });
  }

  /**
   * Handle connection close.
   */
  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;

    // Resolve any pending receive with null to signal end
    if (this.messageResolve) {
      const resolve = this.messageResolve;
      this.messageResolve = null;
      resolve(null);
    }
  }

  /**
   * Wait for the send buffer to drain below high water mark.
   */
  private async waitForDrain(): Promise<void> {
    // PeerJS exposes bufferedAmount on the underlying RTCDataChannel
    const channel = (this.conn as unknown as { _dc?: RTCDataChannel })._dc;
    if (!channel) return;

    while (channel.bufferedAmount > this.highWaterMark && channel.readyState === "open") {
      await new Promise((resolve) => setTimeout(resolve, this.drainInterval));
    }
  }

  /**
   * Read the next message from the connection.
   * Returns null when connection closes.
   */
  private nextMessage(): Promise<Uint8Array | null> {
    // If we have queued messages, return one
    if (this.messageQueue.length > 0) {
      return Promise.resolve(this.messageQueue.shift()!);
    }

    // If closed, return null
    if (this.closed) {
      return Promise.resolve(null);
    }

    // If error, reject
    if (this.error) {
      return Promise.reject(this.error);
    }

    // Wait for next message
    return new Promise((resolve) => {
      this.messageResolve = resolve;
    });
  }

  /**
   * Create an async iterable of incoming byte chunks.
   */
  private async *incomingBytes(): AsyncIterable<Uint8Array> {
    while (!this.closed) {
      const message = await this.nextMessage();
      if (message === null) {
        break;
      }
      yield message;
    }
  }

  /**
   * Send packets to the peer.
   *
   * Converts packets to pkt-line format and sends over DataConnection.
   */
  async send(packets: AsyncIterable<Packet>): Promise<void> {
    if (this.closed) {
      throw new Error("PeerJS stream is closed");
    }

    // Convert packets to pkt-line encoded bytes and send
    for await (const chunk of pktLineWriter(packets)) {
      if (this.closed || !this.conn.open) {
        throw new Error("PeerJS connection closed during send");
      }

      // Wait for buffer to drain if needed
      await this.waitForDrain();

      // Send the chunk as ArrayBuffer
      this.conn.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
    }
  }

  /**
   * Send raw bytes to the peer.
   */
  async sendRaw(body: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new Error("PeerJS stream is closed");
    }

    if (!this.conn.open) {
      throw new Error("PeerJS connection not open");
    }

    // Wait for buffer to drain if needed
    await this.waitForDrain();

    // Send the raw bytes as ArrayBuffer
    this.conn.send(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  }

  /**
   * Receive packets from the peer.
   *
   * Reads incoming bytes and parses them as pkt-line packets.
   */
  receive(): AsyncIterable<Packet> {
    return pktLineReader(this.incomingBytes());
  }

  /**
   * Close the connection and release resources.
   */
  async close(): Promise<void> {
    if (this.closed) return;

    this.closed = true;

    // Close the connection
    if (this.conn.open) {
      this.conn.close();
    }

    // Resolve any pending receive
    if (this.messageResolve) {
      const resolve = this.messageResolve;
      this.messageResolve = null;
      resolve(null);
    }
  }

  /**
   * Whether the stream is closed.
   */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Whether the underlying connection is open.
   */
  get isOpen(): boolean {
    return this.conn.open && !this.closed;
  }
}

/**
 * Create a TransportConnection from a PeerJS DataConnection.
 *
 * The connection must already be open.
 *
 * IMPORTANT: For binary data support, create the connection with:
 * `peer.connect(peerId, { serialization: "raw", reliable: true })`
 *
 * @param conn The PeerJS DataConnection to wrap
 * @param options Configuration options
 * @returns TransportConnection adapter
 */
export function createPeerJsStream(
  conn: DataConnection,
  options?: PeerJsStreamOptions,
): TransportConnection {
  return new PeerJsStream(conn, options);
}
