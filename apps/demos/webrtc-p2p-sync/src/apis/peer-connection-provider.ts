/**
 * IPeerConnectionProvider — abstraction for peer connection management.
 *
 * Decouples session lifecycle from PeerJS specifics by exposing
 * MessagePort-based communication. Enables testing with in-memory
 * providers (no PeerJS mocking needed).
 */

import { newAdapter } from "../utils/index.js";

export type SessionId = string;

export interface PeerConnectionCallbacks {
  /** Fires when a new peer connects. The port is open and ready. */
  onConnection(peerId: string, port: MessagePort): void;
  /** Fires when a connected peer drops (ICE failure, tab close, explicit close). */
  onPeerDisconnected?(peerId: string): void;
  /** Fires on provider-level errors (signaling server failure, etc). */
  onError?(error: Error): void;
}

export interface PeerConnectionResult {
  port: MessagePort;
  peerId: string;
}

export interface IPeerConnectionProvider {
  /**
   * Start hosting a session.
   *
   * Creates an addressable session. Other peers call `connect(sessionId)` to join.
   * Each incoming connection triggers `callbacks.onConnection` with a ready MessagePort.
   *
   * @returns The session ID that joiners use
   */
  share(callbacks: PeerConnectionCallbacks): Promise<SessionId>;

  /**
   * Connect to an existing hosted session.
   *
   * @returns A ready MessagePort and the host's peerId
   */
  connect(sessionId: SessionId): Promise<PeerConnectionResult>;

  /**
   * Tear down the underlying peer, close all MessagePorts.
   */
  disconnect(): void;
}

export const [getConnectionProvider, setConnectionProvider] =
  newAdapter<IPeerConnectionProvider>("connection-provider");
