/**
 * LiveKit transport types for VCS peer-to-peer synchronization.
 */

/**
 * Options for creating a LiveKit port (MessagePort bridge).
 */
export interface LiveKitPortOptions {
  /** Use reliable delivery (default: true). Required for Git protocol. */
  reliable?: boolean;
}

/**
 * Options for connecting to a LiveKit room.
 */
export interface RoomConnectionOptions {
  /** LiveKit server URL (e.g. "ws://localhost:7880") */
  url: string;
  /** Authentication token (JWT) */
  token: string;
  /** Auto-subscribe to data from other participants (default: true) */
  autoSubscribe?: boolean;
}

/**
 * Information about a participant in the room.
 */
export interface ParticipantInfo {
  /** Unique identity string */
  identity: string;
  /** Display name (may be empty) */
  name: string;
  /** Whether the participant is currently connected */
  connected: boolean;
}

/**
 * Events emitted by the RoomManager.
 */
export interface RoomManagerEvents {
  /** A new participant joined the room */
  participantConnected: (info: ParticipantInfo) => void;
  /** A participant left the room */
  participantDisconnected: (info: ParticipantInfo) => void;
  /** Room connection state changed */
  connectionStateChanged: (state: string) => void;
  /** An error occurred */
  error: (error: Error) => void;
}
