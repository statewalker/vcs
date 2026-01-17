/**
 * WebRTC DataChannel to TransportConnection adapter.
 *
 * Adapts a WebRTC RTCDataChannel to implement the TransportConnection
 * interface for Git protocol communication over peer-to-peer connections.
 *
 * Features:
 * - Bidirectional packet streaming over DataChannel
 * - Proper message framing for binary data
 * - Backpressure handling via bufferedAmount
 * - Clean resource cleanup
 */

import type { Packet, TransportConnection } from "@statewalker/vcs-transport";
import { pktLineReader, pktLineWriter } from "@statewalker/vcs-transport";

/**
 * Options for creating a WebRTC stream.
 */
export interface WebRtcStreamOptions {
  /** High water mark for backpressure (bytes) */
  highWaterMark?: number;
  /** Interval to check bufferedAmount (ms) */
  drainInterval?: number;
}

const DEFAULT_HIGH_WATER_MARK = 64 * 1024; // 64KB
const DEFAULT_DRAIN_INTERVAL = 10; // 10ms

/**
 * Adapter that wraps RTCDataChannel as a TransportConnection.
 *
 * The DataChannel must be open before use. Messages are sent/received
 * as binary ArrayBuffers, which are then framed using pkt-line protocol.
 */
export class WebRtcStream implements TransportConnection {
  private readonly channel: RTCDataChannel;
  private readonly highWaterMark: number;
  private readonly drainInterval: number;
  private closed = false;

  // Incoming message queue for receive()
  private readonly messageQueue: Uint8Array[] = [];
  private messageResolve: ((value: Uint8Array | null) => void) | null = null;
  private error: Error | null = null;

  constructor(channel: RTCDataChannel, options: WebRtcStreamOptions = {}) {
    this.channel = channel;
    this.highWaterMark = options.highWaterMark ?? DEFAULT_HIGH_WATER_MARK;
    this.drainInterval = options.drainInterval ?? DEFAULT_DRAIN_INTERVAL;

    // Ensure binary mode
    this.channel.binaryType = "arraybuffer";

    // Set up message handling
    this.setupHandlers();
  }

  /**
   * Set up DataChannel event handlers.
   */
  private setupHandlers(): void {
    this.channel.onmessage = (event: MessageEvent) => {
      if (this.closed) return;

      const data =
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : new Uint8Array(event.data as ArrayBuffer);

      // If someone is waiting for data, resolve immediately
      if (this.messageResolve) {
        const resolve = this.messageResolve;
        this.messageResolve = null;
        resolve(data);
      } else {
        // Otherwise queue it
        this.messageQueue.push(data);
      }
    };

    this.channel.onerror = (event: Event) => {
      const errorEvent = event as RTCErrorEvent;
      this.error = errorEvent.error ?? new Error("DataChannel error");
      this.handleClose();
    };

    this.channel.onclose = () => {
      this.handleClose();
    };
  }

  /**
   * Handle channel close.
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
    while (this.channel.bufferedAmount > this.highWaterMark && this.channel.readyState === "open") {
      await new Promise((resolve) => setTimeout(resolve, this.drainInterval));
    }
  }

  /**
   * Read the next message from the channel.
   * Returns null when channel closes.
   */
  private nextMessage(): Promise<Uint8Array | null> {
    // If we have queued messages, return one
    if (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message !== undefined) {
        return Promise.resolve(message);
      }
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
   * Converts packets to pkt-line format and sends over DataChannel.
   */
  async send(packets: AsyncIterable<Packet>): Promise<void> {
    if (this.closed) {
      throw new Error("WebRTC stream is closed");
    }

    // Convert packets to pkt-line encoded bytes and send
    for await (const chunk of pktLineWriter(packets)) {
      if (this.closed || this.channel.readyState !== "open") {
        throw new Error("WebRTC channel closed during send");
      }

      // Wait for buffer to drain if needed
      await this.waitForDrain();

      // Send the chunk (convert to ArrayBuffer for TypeScript compatibility)
      this.channel.send(
        chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer,
      );
    }
  }

  /**
   * Send raw bytes to the peer.
   */
  async sendRaw(body: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new Error("WebRTC stream is closed");
    }

    if (this.channel.readyState !== "open") {
      throw new Error("WebRTC channel not open");
    }

    // Wait for buffer to drain if needed
    await this.waitForDrain();

    // Send the raw bytes (convert to ArrayBuffer for TypeScript compatibility)
    this.channel.send(
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    );
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

    // Close the data channel
    if (this.channel.readyState === "open") {
      this.channel.close();
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
   * Current buffered amount waiting to be sent.
   */
  get bufferedAmount(): number {
    return this.channel.bufferedAmount;
  }

  /**
   * Current ready state of the underlying channel.
   */
  get readyState(): RTCDataChannelState {
    return this.channel.readyState;
  }
}

/**
 * Create a TransportConnection from an RTCDataChannel.
 *
 * The channel must already be open or opening.
 *
 * @param channel The RTCDataChannel to wrap
 * @param options Configuration options
 * @returns TransportConnection adapter
 */
export function createWebRtcStream(
  channel: RTCDataChannel,
  options?: WebRtcStreamOptions,
): TransportConnection {
  return new WebRtcStream(channel, options);
}
