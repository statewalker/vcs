/**
 * GitPeerSession for unified P2P git communication.
 *
 * Handles both client and server roles for peer-to-peer git synchronization.
 * Each peer can act as both client (fetch/push) and server (handle incoming).
 *
 * Architecture:
 * - fetchFrom(port): CLIENT role - fetch objects from remote peer
 * - pushTo(port, refs): CLIENT role - push objects to remote peer
 * - handleIncoming(port): SERVER role - handle incoming git protocol requests
 * - sync(port): Convenience method for bidirectional sync
 */

import type { MessagePortLike } from "@statewalker/vcs-utils";
import { bytesToHex } from "@statewalker/vcs-utils/hash/utils";
import { GitConnection } from "../connection/git-connection.js";
import { createPortTcpSocket } from "../connection/port-tcp-socket.js";
import { createReceivePackHandler, createUploadPackHandler } from "../handlers/index.js";
import type { RepositoryAccess } from "../handlers/types.js";
import {
  type GitProtocolRequest,
  parseGitProtocolRequest,
} from "../protocol/git-request-parser.js";
import { parsePacket } from "../protocol/pkt-line-codec.js";

/**
 * Progress callback for transfer operations.
 */
export type PeerProgressCallback = (phase: string, message: string) => void;

/**
 * Error callback for error handling.
 */
export type PeerErrorCallback = (error: Error) => void;

/**
 * Options for GitPeerSession.
 */
export interface GitPeerSessionOptions {
  /** Repository access for server-side operations */
  repository: RepositoryAccess;
  /** Progress callback for transfer phases */
  onProgress?: PeerProgressCallback;
  /** Error callback for error reporting */
  onError?: PeerErrorCallback;
}

/**
 * Result of a peer fetch operation.
 */
export interface PeerFetchResult {
  /** Refs received from the peer */
  refs: Map<string, string>;
  /** Number of objects received */
  objectsReceived: number;
  /** Number of bytes received */
  bytesReceived: number;
}

/**
 * Reference update for peer push operations.
 */
export interface PeerRefUpdate {
  /** Reference name (e.g., "refs/heads/main") */
  ref: string;
  /** Previous object ID (null for creates) */
  oldId: string | null;
  /** New object ID (null for deletes) */
  newId: string | null;
}

/**
 * Result of a peer push operation.
 */
export interface PeerPushResult {
  /** Accepted ref updates */
  accepted: PeerRefUpdate[];
  /** Rejected ref updates with reasons */
  rejected: Array<{ ref: string; reason: string }>;
}

/**
 * Result of a peer sync operation.
 */
export interface PeerSyncResult {
  /** Changes fetched from the peer */
  localChanges: PeerFetchResult;
  /** Changes pushed to the peer */
  remoteChanges: PeerPushResult;
}

/**
 * GitPeerSession provides unified P2P git communication.
 *
 * Example usage:
 * ```typescript
 * const session = new GitPeerSession({ repository });
 *
 * // As client - fetch from peer
 * const result = await session.fetchFrom(port);
 *
 * // As server - handle incoming request
 * await session.handleIncoming(port);
 * ```
 */
export class GitPeerSession {
  private readonly repository: RepositoryAccess;
  private readonly onProgress?: PeerProgressCallback;
  private readonly onError?: PeerErrorCallback;

  constructor(options: GitPeerSessionOptions) {
    this.repository = options.repository;
    this.onProgress = options.onProgress;
    this.onError = options.onError;
  }

  /**
   * CLIENT role - Fetch objects from a remote peer.
   *
   * Creates a git:// protocol connection over the MessagePort and
   * performs a fetch operation using the upload-pack protocol.
   *
   * @param port - MessagePort-like connection to the peer
   * @returns Fetch result with refs and statistics
   */
  async fetchFrom(port: MessagePortLike): Promise<PeerFetchResult> {
    this.reportProgress("fetch", "Connecting to peer...");

    const socket = createPortTcpSocket(port);
    const conn = new GitConnection(
      { host: "peer", path: "/", service: "git-upload-pack" },
      () => socket,
    );

    try {
      // Discover refs from peer
      this.reportProgress("fetch", "Discovering refs...");
      const advertisement = await conn.discoverRefs();

      // Convert Map<string, Uint8Array> to Map<string, string>
      const refMap = new Map<string, string>();
      for (const [name, idBytes] of advertisement.refs.entries()) {
        refMap.set(name, bytesToHex(idBytes));
      }

      // TODO: Implement actual fetch negotiation
      // For now, return the discovered refs
      this.reportProgress("fetch", `Found ${refMap.size} refs`);

      return {
        refs: refMap,
        objectsReceived: 0,
        bytesReceived: 0,
      };
    } catch (error) {
      this.reportError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      await conn.close();
    }
  }

  /**
   * CLIENT role - Push objects to a remote peer.
   *
   * Creates a git:// protocol connection over the MessagePort and
   * performs a push operation using the receive-pack protocol.
   *
   * @param port - MessagePort-like connection to the peer
   * @param refs - Reference updates to push
   * @returns Push result with accepted/rejected refs
   */
  async pushTo(port: MessagePortLike, refs: PeerRefUpdate[]): Promise<PeerPushResult> {
    this.reportProgress("push", "Connecting to peer...");

    const socket = createPortTcpSocket(port);
    const conn = new GitConnection(
      { host: "peer", path: "/", service: "git-receive-pack" },
      () => socket,
    );

    try {
      // Discover refs from peer to start negotiation
      this.reportProgress("push", "Discovering refs...");
      await conn.discoverRefs();

      // TODO: Implement actual push negotiation
      // For now, return empty result
      this.reportProgress("push", `Pushing ${refs.length} refs`);

      return {
        accepted: [],
        rejected: refs.map((r) => ({
          ref: r.ref,
          reason: "Push not yet implemented",
        })),
      };
    } catch (error) {
      this.reportError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      await conn.close();
    }
  }

  /**
   * SERVER role - Handle incoming git protocol request.
   *
   * Reads the initial git:// protocol request to determine the service,
   * then dispatches to the appropriate handler (upload-pack or receive-pack).
   *
   * @param port - MessagePort-like connection from the client
   */
  async handleIncoming(port: MessagePortLike): Promise<void> {
    this.reportProgress("server", "Waiting for connection...");

    const socket = createPortTcpSocket(port);
    await socket.connect();

    try {
      // Parse initial request to determine service
      const request = await this.readProtocolRequest(socket);
      this.reportProgress("server", `Received ${request.service} request for ${request.path}`);

      if (request.service === "git-upload-pack") {
        await this.handleUploadPack(socket);
      } else if (request.service === "git-receive-pack") {
        await this.handleReceivePack(socket);
      } else {
        throw new Error(`Unknown service: ${request.service}`);
      }
    } catch (error) {
      this.reportError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      await socket.close();
    }
  }

  /**
   * Bidirectional sync with a peer.
   *
   * This is a convenience method that performs both fetch and push
   * operations. For true bidirectional sync, use two separate channels.
   *
   * @param port - MessagePort-like connection to the peer
   * @returns Combined sync result
   */
  async sync(port: MessagePortLike): Promise<PeerSyncResult> {
    // For now, just do a fetch
    // True bidirectional sync requires coordination between peers
    const fetchResult = await this.fetchFrom(port);

    return {
      localChanges: fetchResult,
      remoteChanges: {
        accepted: [],
        rejected: [],
      },
    };
  }

  /**
   * Read the initial git protocol request from the socket.
   */
  private async readProtocolRequest(socket: {
    read(): AsyncIterable<Uint8Array>;
  }): Promise<GitProtocolRequest> {
    let buffer = new Uint8Array(0);

    for await (const chunk of socket.read()) {
      // Append chunk to buffer
      const newBuffer = new Uint8Array(buffer.length + chunk.length);
      newBuffer.set(buffer, 0);
      newBuffer.set(chunk, buffer.length);
      buffer = newBuffer;

      // Try to parse a packet
      const result = parsePacket(buffer);
      if (result !== null) {
        if (result.packet.type !== "data" || !result.packet.data) {
          throw new Error("Invalid git protocol request: expected data packet");
        }
        return parseGitProtocolRequest(result.packet.data);
      }
    }

    throw new Error("Connection closed before complete request received");
  }

  /**
   * Handle upload-pack (fetch/clone) request.
   */
  private async handleUploadPack(socket: {
    write(data: Uint8Array): Promise<void>;
    read(): AsyncIterable<Uint8Array>;
  }): Promise<void> {
    this.reportProgress("upload-pack", "Creating handler...");

    const handler = createUploadPackHandler({
      repository: this.repository,
    });

    // Send ref advertisement
    this.reportProgress("upload-pack", "Sending ref advertisement...");
    for await (const chunk of handler.advertise()) {
      await socket.write(chunk);
    }

    // Process client request and send pack
    this.reportProgress("upload-pack", "Processing request...");
    for await (const chunk of handler.process(socket.read())) {
      await socket.write(chunk);
    }

    this.reportProgress("upload-pack", "Complete");
  }

  /**
   * Handle receive-pack (push) request.
   */
  private async handleReceivePack(socket: {
    write(data: Uint8Array): Promise<void>;
    read(): AsyncIterable<Uint8Array>;
  }): Promise<void> {
    this.reportProgress("receive-pack", "Creating handler...");

    const handler = createReceivePackHandler({
      repository: this.repository,
    });

    // Send ref advertisement
    this.reportProgress("receive-pack", "Sending ref advertisement...");
    for await (const chunk of handler.advertise()) {
      await socket.write(chunk);
    }

    // Process client request (receive pack and update refs)
    this.reportProgress("receive-pack", "Processing request...");
    for await (const chunk of handler.process(socket.read())) {
      await socket.write(chunk);
    }

    this.reportProgress("receive-pack", "Complete");
  }

  /**
   * Report progress to callback if provided.
   */
  private reportProgress(phase: string, message: string): void {
    this.onProgress?.(phase, message);
  }

  /**
   * Report error to callback if provided.
   */
  private reportError(error: Error): void {
    this.onError?.(error);
  }
}

/**
 * Create a GitPeerSession instance.
 *
 * @param options - Session configuration
 * @returns GitPeerSession instance
 */
export function createGitPeerSession(options: GitPeerSessionOptions): GitPeerSession {
  return new GitPeerSession(options);
}
