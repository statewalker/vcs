/**
 * Peers collection model.
 *
 * Tracks all connected peers and their states.
 */

import { BaseClass, newAdapter } from "../utils/index.js";

/**
 * Connection status of a peer.
 */
export type PeerStatus = "connecting" | "connected" | "disconnected";

/**
 * State of a single peer.
 */
export interface PeerState {
  /** Unique peer ID. */
  id: string;
  /** Display name (truncated ID or custom name). */
  displayName: string;
  /** Current connection status. */
  status: PeerStatus;
  /** Whether this peer is the session host. */
  isHost: boolean;
  /** Timestamp of last successful sync. */
  lastSyncAt: Date | null;
}

/**
 * Peers model - collection of connected peers.
 *
 * This model holds NO business logic. Controllers update this model
 * when PeerJS connection events occur.
 */
export class PeersModel extends BaseClass {
  private peers: Map<string, PeerState> = new Map();

  /**
   * Get all peers as an array.
   */
  getAll(): PeerState[] {
    return Array.from(this.peers.values());
  }

  /**
   * Get a specific peer by ID.
   */
  get(id: string): PeerState | undefined {
    return this.peers.get(id);
  }

  /**
   * Check if a peer exists.
   */
  has(id: string): boolean {
    return this.peers.has(id);
  }

  /**
   * Get the number of peers.
   */
  get count(): number {
    return this.peers.size;
  }

  /**
   * Add a new peer.
   */
  addPeer(peer: PeerState): void {
    this.peers.set(peer.id, peer);
    this.notify();
  }

  /**
   * Update an existing peer's properties.
   */
  updatePeer(id: string, partial: Partial<PeerState>): void {
    const peer = this.peers.get(id);
    if (peer) {
      Object.assign(peer, partial);
      this.notify();
    }
  }

  /**
   * Remove a peer.
   */
  removePeer(id: string): void {
    if (this.peers.delete(id)) {
      this.notify();
    }
  }

  /**
   * Clear all peers.
   */
  clear(): void {
    if (this.peers.size > 0) {
      this.peers.clear();
      this.notify();
    }
  }

  /**
   * Get connected peers only.
   */
  getConnected(): PeerState[] {
    return this.getAll().filter((p) => p.status === "connected");
  }

  /**
   * Get the host peer (if we're a joiner).
   */
  getHost(): PeerState | undefined {
    return this.getAll().find((p) => p.isHost);
  }
}

/**
 * Context adapter for PeersModel.
 */
export const [getPeersModel, setPeersModel] = newAdapter<PeersModel>(
  "peers-model",
  () => new PeersModel(),
);
