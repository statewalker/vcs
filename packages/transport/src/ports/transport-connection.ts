/**
 * TransportConnection implementation using ACK-based backpressure.
 *
 * Uses createPortStream from utils internally for reliable flow control.
 * Packets are converted to pkt-line format, chunked, and sent with ACK
 * acknowledgment between each chunk.
 */

import {
  createPortStream,
  type MessagePortLike,
  type PortStream,
  toChunks,
} from "@statewalker/vcs-utils";
import type { TransportConnection } from "../connection/types.js";
import { pktLineReader, pktLineWriter } from "../protocol/pkt-line-codec.js";
import type { Packet } from "../protocol/types.js";

/**
 * Options for creating a PortTransportConnection.
 */
export interface PortTransportConnectionOptions {
  /** Block size for chunking (default: 128KB) */
  blockSize?: number;
  /** ACK timeout in ms (default: 30000) */
  ackTimeout?: number;
}

const DEFAULT_BLOCK_SIZE = 128 * 1024;

/**
 * TransportConnection implementation using ACK-based backpressure.
 *
 * Uses createPortStream internally for reliable flow control.
 */
export class PortTransportConnection implements TransportConnection {
  private readonly portStream: PortStream;
  private readonly blockSize: number;
  private closed = false;

  constructor(port: MessagePortLike, options: PortTransportConnectionOptions = {}) {
    this.blockSize = options.blockSize ?? DEFAULT_BLOCK_SIZE;
    this.portStream = createPortStream(port, {
      ackTimeout: options.ackTimeout,
    });
  }

  /**
   * Send packets to the remote endpoint.
   *
   * Packets are encoded to pkt-line format, chunked, and sent with
   * ACK-based backpressure.
   */
  async send(packets: AsyncIterable<Packet>): Promise<void> {
    if (this.closed) throw new Error("Connection closed");

    // Packets → pkt-line binary → fixed-size blocks
    const binaryStream = pktLineWriter(packets);
    const blocks = toChunks(binaryStream, this.blockSize);

    // Send with ACK-based backpressure
    await this.portStream.send(blocks);
  }

  /**
   * Send raw bytes to the remote endpoint.
   *
   * Data is chunked and sent with ACK-based backpressure.
   */
  async sendRaw(body: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("Connection closed");

    // Chunk the body and send
    const blocks = toChunks([body], this.blockSize);
    await this.portStream.send(blocks);
  }

  /**
   * Receive packets from the remote endpoint.
   *
   * Blocks are received with ACK acknowledgment and parsed as pkt-line packets.
   */
  receive(): AsyncIterable<Packet> {
    // Blocks → pkt-line binary → Packets
    const blocks = this.portStream.receive();
    return pktLineReader(blocks);
  }

  /**
   * Close the connection and release resources.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.portStream.close();
  }

  /**
   * Whether the connection is closed.
   */
  get isClosed(): boolean {
    return this.closed;
  }
}

/**
 * Create a TransportConnection from a MessagePortLike.
 *
 * Uses ACK-based backpressure for reliable flow control.
 *
 * @param port MessagePortLike to use for communication
 * @param options Configuration options
 * @returns TransportConnection adapter
 */
export function createPortTransportConnection(
  port: MessagePortLike,
  options?: PortTransportConnectionOptions,
): TransportConnection {
  return new PortTransportConnection(port, options);
}
