/**
 * WebRTC transport types
 *
 * Types for peer-to-peer Git synchronization over WebRTC data channels.
 */

/**
 * WebRTC peer role in the connection.
 */
export type PeerRole = "initiator" | "responder";

/**
 * Connection state for a WebRTC peer.
 */
export type ConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

/**
 * ICE candidate for connection establishment.
 */
export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

/**
 * Session description for WebRTC signaling.
 */
export interface SessionDescription {
  type: "offer" | "answer";
  sdp: string;
}

/**
 * Signaling message exchanged between peers.
 */
export type SignalingMessage =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "candidate"; candidate: IceCandidate }
  | { type: "ready" };

/**
 * Compressed signaling data for QR code exchange.
 *
 * Contains all information needed to establish a connection
 * in a single compact payload suitable for QR codes.
 */
export interface CompressedSignal {
  /** Protocol version */
  v: number;
  /** Session ID for matching peers */
  id: string;
  /** Peer role */
  role: PeerRole;
  /** SDP offer or answer (compressed) */
  sdp: string;
  /** ICE candidates (compressed) */
  ice: string[];
}

/**
 * Options for creating a WebRTC peer connection.
 */
export interface WebRtcConnectionOptions {
  /** ICE servers for connection establishment */
  iceServers?: RTCIceServer[];
  /** Timeout for connection establishment (ms) */
  connectionTimeout?: number;
  /** Timeout for ICE gathering (ms) */
  iceGatheringTimeout?: number;
  /** Data channel label */
  channelLabel?: string;
  /** Whether to use ordered delivery */
  ordered?: boolean;
  /** Maximum retransmits for unreliable mode */
  maxRetransmits?: number;
}

/**
 * Events emitted by the peer manager.
 */
export interface PeerManagerEvents {
  /** Emitted when connection state changes */
  stateChange: (state: ConnectionState) => void;
  /** Emitted when a signaling message is ready to send */
  signal: (message: SignalingMessage) => void;
  /** Emitted when the data channel opens */
  open: () => void;
  /** Emitted when the connection closes */
  close: () => void;
  /** Emitted on error */
  error: (error: Error) => void;
}

/**
 * Statistics about the WebRTC connection.
 */
export interface WebRtcStats {
  /** Bytes sent over the data channel */
  bytesSent: number;
  /** Bytes received over the data channel */
  bytesReceived: number;
  /** Current RTT in milliseconds */
  roundTripTimeMs?: number;
  /** Connection duration in milliseconds */
  connectionDurationMs: number;
  /** Number of ICE candidates gathered */
  candidatesGathered: number;
}

/**
 * Default ICE servers (public STUN servers).
 */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
