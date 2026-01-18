/**
 * Unified TransportConnection implementation using MessagePortLike interface.
 *
 * This single implementation replaces transport-specific streams
 * (WebRtcStream, PeerJsStream, etc.) by accepting any MessagePortLikeExtended.
 */

import type { TransportConnection } from "../connection/types.js";
import { pktLineReader, pktLineWriter } from "../protocol/pkt-line-codec.js";
import type { Packet } from "../protocol/types.js";
import type { MessagePortLikeExtended } from "./types.js";

/**
 * Options for creating a MessagePortStream.
 */
export interface MessagePortStreamOptions {
  /** High water mark for backpressure (bytes). Default: 64KB */
  highWaterMark?: number;
  /** Interval to check bufferedAmount (ms). Default: 10ms */
  drainInterval?: number;
}

const DEFAULT_HIGH_WATER_MARK = 64 * 1024;
const DEFAULT_DRAIN_INTERVAL = 10;

/**
 * TransportConnection implementation using MessagePortLike interface.
 *
 * This single implementation replaces transport-specific streams
 * (WebRtcStream, PeerJsStream, etc.) by accepting any MessagePortLikeExtended.
 *
 * Features:
 * - Bidirectional packet streaming over any MessagePortLike
 * - Backpressure handling via bufferedAmount
 * - Async iteration over incoming bytes
 * - pkt-line encoding/decoding
 * - Clean resource cleanup
 */
export class MessagePortStream implements TransportConnection {
  private readonly port: MessagePortLikeExtended;
  private readonly highWaterMark: number;
  private readonly drainInterval: number;
  private closed = false;

  // Incoming message queue
  private readonly messageQueue: Uint8Array[] = [];
  private messageResolve: ((value: Uint8Array | null) => void) | null = null;
  private error: Error | null = null;

  constructor(port: MessagePortLikeExtended, options: MessagePortStreamOptions = {}) {
    this.port = port;
    this.highWaterMark = options.highWaterMark ?? DEFAULT_HIGH_WATER_MARK;
    this.drainInterval = options.drainInterval ?? DEFAULT_DRAIN_INTERVAL;
    this.setupHandlers();
  }

  /**
   * Set up port event handlers.
   */
  private setupHandlers(): void {
    this.port.onmessage = (event) => {
      if (this.closed) return;

      const bytes = new Uint8Array(event.data);

      // If someone is waiting for data, resolve immediately
      if (this.messageResolve) {
        const resolve = this.messageResolve;
        this.messageResolve = null;
        resolve(bytes);
      } else {
        // Otherwise queue it
        this.messageQueue.push(bytes);
      }
    };

    this.port.onerror = (err) => {
      this.error = err;
      this.handleClose();
    };

    this.port.onclose = () => this.handleClose();
    this.port.start();
  }

  /**
   * Handle port close.
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
    while (this.port.bufferedAmount > this.highWaterMark && this.port.isOpen) {
      await new Promise((r) => setTimeout(r, this.drainInterval));
    }
  }

  /**
   * Read the next message from the port.
   * Returns null when port closes.
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
      if (message === null) break;
      yield message;
    }
  }

  /**
   * Send packets to the remote endpoint.
   *
   * Converts packets to pkt-line format and sends over the port.
   */
  async send(packets: AsyncIterable<Packet>): Promise<void> {
    if (this.closed) {
      throw new Error("MessagePort stream is closed");
    }

    for await (const chunk of pktLineWriter(packets)) {
      if (this.closed || !this.port.isOpen) {
        throw new Error("MessagePort closed during send");
      }

      await this.waitForDrain();
      this.port.postMessage(chunk);
    }
  }

  /**
   * Send raw bytes to the remote endpoint.
   */
  async sendRaw(body: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new Error("MessagePort stream is closed");
    }

    if (!this.port.isOpen) {
      throw new Error("MessagePort not open");
    }

    await this.waitForDrain();
    this.port.postMessage(body);
  }

  /**
   * Receive packets from the remote endpoint.
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
    this.port.close();

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
   * Whether the stream is open and ready for communication.
   */
  get isOpen(): boolean {
    return this.port.isOpen && !this.closed;
  }

  /**
   * Current buffered amount waiting to be sent.
   */
  get bufferedAmount(): number {
    return this.port.bufferedAmount;
  }
}

/**
 * Create a TransportConnection from any MessagePortLikeExtended.
 *
 * @param port The MessagePortLikeExtended to wrap
 * @param options Configuration options
 * @returns TransportConnection adapter
 */
export function createMessagePortStream(
  port: MessagePortLikeExtended,
  options?: MessagePortStreamOptions,
): TransportConnection {
  return new MessagePortStream(port, options);
}
