import { Base } from "../utils/index.js";

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
export class ConnectionModel extends Base {
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
    return this.update(() => {
      this.#state = "connecting";
      this.#peerRole = role;
      this.#error = null;
    
    });
  }

  setConnected(): void {
    return this.update(() => {
      this.#state = "connected";
      this.#error = null;
    
    });
  }

  setDisconnected(): void {
    return this.update(() => {
      this.#state = "disconnected";
    
    });
  }

  setFailed(error: string): void {
    return this.update(() => {
      this.#state = "failed";
      this.#error = error;
    
    });
  }

  reset(): void {
    return this.update(() => {
      this.#state = "new";
      this.#peerRole = null;
      this.#error = null;
    
    });
  }
}
