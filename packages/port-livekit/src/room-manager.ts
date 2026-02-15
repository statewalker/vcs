/**
 * LiveKit Room connection lifecycle manager.
 *
 * Provides a simplified API for connecting to a LiveKit room and
 * monitoring participant changes. Wraps the LiveKit Room class
 * with event-based notifications for the VCS sync use case.
 */

import { ConnectionState, type RemoteParticipant, Room, RoomEvent } from "livekit-client";

import type { ParticipantInfo, RoomConnectionOptions, RoomManagerEvents } from "./types.js";

type EventHandler<K extends keyof RoomManagerEvents> = RoomManagerEvents[K];

/**
 * Manages LiveKit room connection and participant tracking.
 *
 * @example
 * ```typescript
 * const manager = new RoomManager();
 * manager.on("participantConnected", (info) => {
 *   console.log(`${info.identity} joined`);
 * });
 * await manager.connect({ url: "ws://localhost:7880", token });
 * ```
 */
export class RoomManager {
  private room: Room;
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor() {
    this.room = new Room();
    this.setupRoomEvents();
  }

  /** The underlying LiveKit Room instance */
  getRoom(): Room {
    return this.room;
  }

  /** Local participant identity (available after connect) */
  getLocalIdentity(): string | undefined {
    return this.room.localParticipant?.identity;
  }

  /** Current connection state */
  getConnectionState(): string {
    return this.room.state;
  }

  /** Whether the room is connected */
  isConnected(): boolean {
    return this.room.state === ConnectionState.Connected;
  }

  /** List of currently connected remote participants */
  getParticipants(): ParticipantInfo[] {
    const result: ParticipantInfo[] = [];
    for (const [, p] of this.room.remoteParticipants) {
      result.push({
        identity: p.identity,
        name: p.name ?? "",
        connected: true,
      });
    }
    return result;
  }

  /**
   * Connect to a LiveKit room.
   *
   * @param options - Connection options (url, token)
   */
  async connect(options: RoomConnectionOptions): Promise<void> {
    const { url, token, autoSubscribe = true } = options;
    await this.room.connect(url, token, { autoSubscribe });
  }

  /**
   * Disconnect from the room.
   */
  async disconnect(): Promise<void> {
    await this.room.disconnect();
  }

  /**
   * Register an event handler.
   */
  on<K extends keyof RoomManagerEvents>(event: K, handler: EventHandler<K>): this {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Remove an event handler.
   */
  off<K extends keyof RoomManagerEvents>(event: K, handler: EventHandler<K>): this {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler as (...args: unknown[]) => void);
    }
    return this;
  }

  private emit<K extends keyof RoomManagerEvents>(
    event: K,
    ...args: Parameters<RoomManagerEvents[K]>
  ): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        handler(...(args as unknown[]));
      }
    }
  }

  private setupRoomEvents(): void {
    this.room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      this.emit("participantConnected", {
        identity: participant.identity,
        name: participant.name ?? "",
        connected: true,
      });
    });

    this.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      this.emit("participantDisconnected", {
        identity: participant.identity,
        name: participant.name ?? "",
        connected: false,
      });
    });

    this.room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      this.emit("connectionStateChanged", state);
    });
  }
}
