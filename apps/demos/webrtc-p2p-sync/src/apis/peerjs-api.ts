/**
 * PeerJS API abstraction for dependency injection.
 *
 * This interface abstracts the PeerJS library, enabling:
 * - Unit testing with mock implementations
 * - Swapping underlying WebRTC libraries
 * - Controlled test scenarios
 */

import { newAdapter } from "../utils/index.js";

/**
 * Abstraction over PeerJS DataConnection.
 */
export interface PeerConnection {
  /** The ID of the remote peer. */
  readonly peer: string;

  /** Whether the connection is open. */
  readonly open: boolean;

  /** Send data over the connection. */
  send(data: ArrayBuffer | Uint8Array): void;

  /** Close the connection. */
  close(): void;

  /** Add an event listener. */
  on(event: "open", handler: () => void): void;
  on(event: "close", handler: () => void): void;
  on(event: "data", handler: (data: unknown) => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;

  /** Remove an event listener. */
  off(event: string, handler: (...args: unknown[]) => void): void;
}

/**
 * Abstraction over PeerJS Peer instance.
 */
export interface PeerInstance {
  /** The ID assigned to this peer. */
  readonly id: string;

  /** Whether the peer is connected to the signaling server. */
  readonly open: boolean;

  /**
   * Connect to another peer.
   *
   * @param peerId The ID of the peer to connect to
   * @param options Connection options
   * @returns A PeerConnection
   */
  connect(peerId: string, options?: { serialization?: string; reliable?: boolean }): PeerConnection;

  /** Destroy this peer and clean up resources. */
  destroy(): void;

  /** Add an event listener. */
  on(event: "open", handler: (id: string) => void): void;
  on(event: "connection", handler: (conn: PeerConnection) => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  on(event: "close", handler: () => void): void;
  on(event: "disconnected", handler: () => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;

  /** Remove an event listener. */
  off(event: string, handler: (...args: unknown[]) => void): void;
}

/**
 * Factory interface for creating PeerJS peers.
 */
export interface PeerJsApi {
  /**
   * Create a new peer instance.
   *
   * @param id Optional peer ID. If not provided, server assigns one.
   * @returns A PeerInstance
   */
  createPeer(id?: string): PeerInstance;
}

/**
 * Context adapter for PeerJS API.
 */
export const [getPeerJsApi, setPeerJsApi] = newAdapter<PeerJsApi>("peerjs-api");

/**
 * Real PeerJS implementation.
 * This wraps the actual PeerJS library.
 */
export async function createRealPeerJsApi(): Promise<PeerJsApi> {
  // Dynamic import for ESM compatibility
  const { default: Peer } = await import("peerjs");

  return {
    createPeer(id?: string): PeerInstance {
      const peer = id ? new Peer(id) : new Peer();
      return peer as PeerInstance;
    },
  };
}
