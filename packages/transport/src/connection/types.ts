/**
 * Connection abstraction types.
 *
 * These interfaces abstract the underlying transport mechanism (HTTP, TCP, etc.)
 * so the protocol layer doesn't need to know about connection details.
 */

import type { Packet, RefAdvertisement, ServiceType } from "../protocol/types.js";

/**
 * Bidirectional transport connection.
 *
 * The connection provides methods for sending and receiving packets.
 * Both use the same pkt-line framing regardless of underlying protocol.
 */
export interface TransportConnection {
  /**
   * Send packets to server.
   * For HTTP, this builds the request body.
   * For TCP, this writes directly to the socket.
   */
  send(packets: AsyncIterable<Packet>): Promise<void>;

  /**
   * Send raw bytes to server (optional).
   * Use this when you have pre-built pkt-line encoded data.
   * Not all connections support this - HTTP does, TCP uses send().
   */
  sendRaw?(body: Uint8Array): Promise<void>;

  /**
   * Receive packets from server.
   * Yields packets until the connection closes or an error occurs.
   */
  receive(): AsyncIterable<Packet>;

  /**
   * Close connection and release resources.
   */
  close(): Promise<void>;
}

/**
 * Connection that supports ref discovery.
 */
export interface DiscoverableConnection extends TransportConnection {
  /**
   * Discover refs from the server.
   * This is typically done before the main request.
   */
  discoverRefs(): Promise<RefAdvertisement>;
}

/**
 * Factory for creating connections to a repository.
 */
export interface ConnectionFactory {
  /**
   * Open connection for upload-pack service (fetch/clone).
   */
  openUploadPack(): Promise<DiscoverableConnection>;

  /**
   * Open connection for receive-pack service (push).
   */
  openReceivePack(): Promise<DiscoverableConnection>;
}

/**
 * Authentication credentials.
 */
export interface Credentials {
  username: string;
  password?: string;
  token?: string;
}

/**
 * Authentication provider.
 */
export interface AuthProvider {
  /**
   * Get credentials for a URL.
   * Returns null if no credentials are available.
   */
  getCredentials(url: string): Promise<Credentials | null>;

  /**
   * Store credentials after successful authentication.
   */
  storeCredentials?(url: string, credentials: Credentials): Promise<void>;

  /**
   * Called when credentials are rejected.
   */
  rejectCredentials?(url: string): Promise<void>;
}

/**
 * Options for creating a connection.
 */
export interface ConnectionOptions {
  /** Repository URL */
  url: string;
  /** Service type (upload-pack or receive-pack) */
  service: ServiceType;
  /** Authentication credentials */
  auth?: Credentials;
  /** Authentication provider */
  authProvider?: AuthProvider;
  /** Custom HTTP headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** User agent string */
  userAgent?: string;
  /** Follow redirects */
  followRedirects?: boolean;
  /** Maximum redirects to follow */
  maxRedirects?: number;
}

/**
 * Progress callback for transfer operations.
 */
export type ProgressCallback = (info: {
  phase: string;
  loaded: number;
  total?: number;
  message?: string;
}) => void;

/**
 * Transfer statistics.
 */
export interface TransferStats {
  /** Total bytes received */
  bytesReceived: number;
  /** Total bytes sent */
  bytesSent: number;
  /** Number of packets received */
  packetsReceived: number;
  /** Number of packets sent */
  packetsSent: number;
  /** Transfer duration in milliseconds */
  durationMs: number;
}
