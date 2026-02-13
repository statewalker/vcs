import { BaseClass } from "../utils/index.js";

/**
 * WebRTC connection states.
 */
export type ConnectionState = "new" | "connecting" | "connected" | "disconnected" | "failed";

/**
 * Peer role in the WebRTC connection.
 */
export type PeerRole = "initiator" | "responder";

/**
 * Model representing WebRTC connection state.
 * Tracks connection status, peer role, and errors.
 */
export class ConnectionModel extends BaseClass {
  #state: ConnectionState = "new";
  #peerRole: PeerRole | null = null;
  #error: string | null = null;

  get state(): ConnectionState {
    return this.#state;
  }

  get peerRole(): PeerRole | null {
    return this.#peerRole;
  }

  get error(): string | null {
    return this.#error;
  }

  get isConnected(): boolean {
    return this.#state === "connected";
  }

  setConnecting(role: PeerRole): void {
    this.#state = "connecting";
    this.#peerRole = role;
    this.#error = null;
    this.notify();
  }

  setConnected(): void {
    this.#state = "connected";
    this.#error = null;
    this.notify();
  }

  setDisconnected(): void {
    this.#state = "disconnected";
    this.notify();
  }

  setFailed(error: string): void {
    this.#state = "failed";
    this.#error = error;
    this.notify();
  }

  reset(): void {
    this.#state = "new";
    this.#peerRole = null;
    this.#error = null;
    this.notify();
  }
}
