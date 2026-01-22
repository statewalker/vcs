/**
 * Native git protocol connection (git://).
 *
 * Uses TCP sockets on port 9418 (default).
 * The first packet sent is the service request with host info.
 *
 * Format: "git-upload-pack /path/to/repo\0host=hostname\0"
 *
 * Based on JGit's TransportGitAnon.java
 */

import { parseRefAdvertisement } from "../negotiation/ref-advertiser.js";
import { GIT_PROTOCOL_PORT, SERVICE_UPLOAD_PACK } from "../protocol/constants.js";
import { ConnectionError } from "../protocol/errors.js";
import { encodePacket, pktLineReader, pktLineWriter } from "../protocol/pkt-line-codec.js";
import type { Packet, RefAdvertisement, ServiceType } from "../protocol/types.js";
import type { BidirectionalSocket } from "../socket/types.js";
import type { DiscoverableConnection } from "./types.js";

/**
 * Options for native git connection.
 */
export interface GitConnectionOptions {
  host: string;
  port?: number;
  path: string;
  service: ServiceType;
}

/**
 * Connectable socket interface for TCP-based connections.
 * Extends BidirectionalSocket with a connect() method.
 */
export interface ConnectableSocket extends BidirectionalSocket {
  connect(): Promise<void>;
}

/**
 * Native git protocol connection using TCP.
 */
export class GitConnection implements DiscoverableConnection {
  private host: string;
  private port: number;
  private path: string;
  private service: ServiceType;
  private socket: ConnectableSocket | null = null;
  private socketFactory: () => ConnectableSocket;
  private connected = false;

  constructor(options: GitConnectionOptions, socketFactory: () => ConnectableSocket) {
    this.host = options.host;
    this.port = options.port ?? GIT_PROTOCOL_PORT;
    this.path = options.path;
    this.service = options.service;
    this.socketFactory = socketFactory;
  }

  /**
   * Connect to the git daemon and send initial request.
   */
  private async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.socket = this.socketFactory();
    await this.socket.connect();

    // Send initial request
    // Format: "git-upload-pack /path\0host=hostname\0"
    const request = `${this.service} ${this.path}\0host=${this.host}\0`;
    await this.socket.write(encodePacket(request));

    this.connected = true;
  }

  /**
   * Discover refs from server.
   */
  async discoverRefs(): Promise<RefAdvertisement> {
    await this.connect();

    if (!this.socket) {
      throw new ConnectionError("Not connected");
    }

    // Read ref advertisement
    const packets = pktLineReader(this.socket.input);
    return parseRefAdvertisement(packets);
  }

  /**
   * Send packets to server.
   */
  async send(packets: AsyncIterable<Packet>): Promise<void> {
    await this.connect();

    if (!this.socket) {
      throw new ConnectionError("Not connected");
    }

    for await (const encoded of pktLineWriter(packets)) {
      await this.socket.write(encoded);
    }
  }

  /**
   * Receive packets from server.
   */
  async *receive(): AsyncIterable<Packet> {
    if (!this.socket) {
      throw new ConnectionError("Not connected");
    }

    yield* pktLineReader(this.socket.input);
  }

  /**
   * Close connection.
   */
  async close(): Promise<void> {
    if (this.socket) {
      await this.socket.close();
      this.socket = null;
    }
    this.connected = false;
  }
}

/**
 * Node.js TCP socket implementation.
 * This is a placeholder - the actual implementation would use Node.js 'net' module.
 */
export function createNodeConnectableSocket(_host: string, _port: number): ConnectableSocket {
  // This would be implemented using Node.js net module
  // For now, we throw an error indicating this needs Node.js environment
  throw new Error(
    "Native git protocol requires Node.js environment. " +
      "Use createNodeGitConnection() from @statewalker/vcs-transport/node",
  );
}

/**
 * Create a git:// connection for upload-pack.
 */
export function createGitConnection(
  host: string,
  path: string,
  socketFactory: () => ConnectableSocket,
  options: Partial<GitConnectionOptions> = {},
): GitConnection {
  return new GitConnection(
    {
      host,
      path,
      service: SERVICE_UPLOAD_PACK,
      ...options,
    },
    socketFactory,
  );
}
