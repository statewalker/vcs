/**
 * PeerJS DataConnection to TransportConnection adapter.
 *
 * Provides a convenience wrapper that combines createPeerJsPort with MessagePortStream
 * for backwards compatibility and ease of use.
 */

import {
  MessagePortStream,
  type MessagePortStreamOptions,
  type TransportConnection,
} from "@statewalker/vcs-transport";
import type { DataConnection } from "peerjs";
import { createPeerJsPort } from "./peerjs-port.js";

/**
 * Options for creating a PeerJS stream.
 */
export interface PeerJsStreamOptions extends MessagePortStreamOptions {}

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
  private readonly stream: MessagePortStream;
  private readonly conn: DataConnection;

  constructor(conn: DataConnection, options: PeerJsStreamOptions = {}) {
    this.conn = conn;
    const port = createPeerJsPort(conn);
    this.stream = new MessagePortStream(port, options);
  }

  send(packets: AsyncIterable<import("@statewalker/vcs-transport").Packet>): Promise<void> {
    return this.stream.send(packets);
  }

  sendRaw(body: Uint8Array): Promise<void> {
    return this.stream.sendRaw(body);
  }

  receive(): AsyncIterable<import("@statewalker/vcs-transport").Packet> {
    return this.stream.receive();
  }

  close(): Promise<void> {
    return this.stream.close();
  }

  get isClosed(): boolean {
    return this.stream.isClosed;
  }

  get isOpen(): boolean {
    return this.conn.open && !this.stream.isClosed;
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
