/**
 * QR code signaling for serverless WebRTC connection.
 *
 * Compresses WebRTC signaling data (SDP + ICE candidates) into a compact
 * format suitable for QR codes. This enables completely serverless P2P
 * connections where users exchange QR codes to establish a connection.
 *
 * The compression strategy:
 * 1. Strip unnecessary SDP lines (most are defaults)
 * 2. Encode ICE candidates compactly
 * 3. Base64 encode the result
 *
 * Typical QR code capacity: ~2953 bytes (version 40, L error correction)
 * Typical compressed signal: 200-500 bytes depending on ICE candidates
 */

import type { CompressedSignal, IceCandidate, PeerRole, SessionDescription } from "./types.js";

/** Current protocol version */
const PROTOCOL_VERSION = 1;

/**
 * Generate a short random session ID.
 */
export function generateSessionId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Compress SDP by removing redundant information.
 *
 * SDP contains many default values that can be reconstructed.
 * We keep only the essential ICE credentials and media descriptions.
 */
function compressSdp(sdp: string): string {
  const lines = sdp.split("\r\n");
  const essential: string[] = [];

  // Keep only essential lines
  for (const line of lines) {
    // Always keep:
    // - v= version (always 0)
    // - o= origin (session ID)
    // - s= session name
    // - t= timing
    // - a=group:BUNDLE (media bundling)
    // - a=ice-ufrag/pwd (ICE credentials)
    // - a=fingerprint (DTLS fingerprint)
    // - a=setup (DTLS role)
    // - m= media line
    // - c= connection (always IN IP4 0.0.0.0)
    // - a=mid (media ID)
    // - a=sctp-port (SCTP port for data channel)
    // - a=max-message-size

    if (
      line.startsWith("v=") ||
      line.startsWith("o=") ||
      line.startsWith("s=") ||
      line.startsWith("t=") ||
      line.startsWith("a=group:") ||
      line.startsWith("a=ice-ufrag:") ||
      line.startsWith("a=ice-pwd:") ||
      line.startsWith("a=fingerprint:") ||
      line.startsWith("a=setup:") ||
      line.startsWith("m=") ||
      line.startsWith("c=") ||
      line.startsWith("a=mid:") ||
      line.startsWith("a=sctp-port:") ||
      line.startsWith("a=max-message-size:")
    ) {
      essential.push(line);
    }
  }

  return essential.join("\n");
}

/**
 * Expand compressed SDP back to valid format.
 */
function expandSdp(compressed: string): string {
  const lines = compressed.split("\n");
  const expanded: string[] = [];

  for (const line of lines) {
    expanded.push(line);

    // Add required defaults after specific lines
    if (line.startsWith("m=application")) {
      // Add required media attributes if not present
      if (!lines.some((l) => l.startsWith("a=sendrecv"))) {
        // Data channels don't need sendrecv
      }
    }
  }

  // Ensure CRLF line endings
  return `${expanded.join("\r\n")}\r\n`;
}

/**
 * Compress ICE candidate to essential parts.
 *
 * Full candidate format:
 * candidate:foundation component protocol priority ip port typ type [raddr addr rport port]
 *
 * We keep: foundation, protocol, priority, ip, port, type
 */
function compressCandidate(candidate: IceCandidate): string {
  const { candidate: c, sdpMid, sdpMLineIndex } = candidate;

  // Parse the candidate string
  const match = c.match(/candidate:(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+typ\s+(\S+)/);

  if (!match) {
    // Can't parse - return as-is with markers
    return `R:${sdpMid ?? ""}:${sdpMLineIndex ?? 0}:${c}`;
  }

  const [, foundation, component, protocol, priority, ip, port, type] = match;

  // Compact format: F|C|P|Pr|IP|Po|T|mid|idx
  return `${foundation}|${component}|${protocol}|${priority}|${ip}|${port}|${type}|${sdpMid ?? ""}|${sdpMLineIndex ?? 0}`;
}

/**
 * Expand compressed ICE candidate.
 */
function expandCandidate(compressed: string): IceCandidate {
  // Check for raw format
  if (compressed.startsWith("R:")) {
    const [, sdpMid, sdpMLineIndexStr, ...rest] = compressed.split(":");
    return {
      candidate: rest.join(":"),
      sdpMid: sdpMid || null,
      sdpMLineIndex: parseInt(sdpMLineIndexStr, 10) || null,
    };
  }

  const parts = compressed.split("|");
  if (parts.length < 9) {
    throw new Error(`Invalid compressed candidate: ${compressed}`);
  }

  const [foundation, component, protocol, priority, ip, port, type, sdpMid, sdpMLineIndexStr] =
    parts;

  // Reconstruct full candidate string
  const candidate =
    `candidate:${foundation} ${component} ${protocol} ${priority} ` + `${ip} ${port} typ ${type}`;

  return {
    candidate,
    sdpMid: sdpMid || null,
    sdpMLineIndex: sdpMLineIndexStr ? parseInt(sdpMLineIndexStr, 10) : null,
  };
}

/**
 * Create a compressed signal for QR code exchange.
 *
 * @param sessionId Unique session ID (both peers must use same ID)
 * @param role Peer role (initiator or responder)
 * @param description Local session description
 * @param candidates Collected ICE candidates
 * @returns Compressed signal suitable for QR code
 */
export function createCompressedSignal(
  sessionId: string,
  role: PeerRole,
  description: SessionDescription,
  candidates: IceCandidate[],
): CompressedSignal {
  return {
    v: PROTOCOL_VERSION,
    id: sessionId,
    role,
    sdp: compressSdp(description.sdp),
    ice: candidates.map(compressCandidate),
  };
}

/**
 * Parse a compressed signal.
 *
 * @param signal Compressed signal from QR code
 * @returns Parsed session description and ICE candidates
 */
export function parseCompressedSignal(signal: CompressedSignal): {
  sessionId: string;
  role: PeerRole;
  description: SessionDescription;
  candidates: IceCandidate[];
} {
  if (signal.v !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported protocol version: ${signal.v}`);
  }

  // Determine SDP type from role
  const type = signal.role === "initiator" ? "offer" : "answer";

  return {
    sessionId: signal.id,
    role: signal.role,
    description: {
      type,
      sdp: expandSdp(signal.sdp),
    },
    candidates: signal.ice.map(expandCandidate),
  };
}

/**
 * Encode a compressed signal to a string for QR code.
 *
 * Uses JSON + base64 encoding for compatibility.
 */
export function encodeSignal(signal: CompressedSignal): string {
  const json = JSON.stringify(signal);
  // Use URL-safe base64
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Decode a signal string from QR code.
 */
export function decodeSignal(encoded: string): CompressedSignal {
  // Restore standard base64
  let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");

  // Add padding if needed
  while (base64.length % 4) {
    base64 += "=";
  }

  const json = atob(base64);
  return JSON.parse(json);
}

/**
 * Estimate the QR code size needed for a signal.
 *
 * Returns the approximate QR code version (1-40) needed.
 * Higher versions have more capacity but are harder to scan.
 */
export function estimateQrVersion(signal: CompressedSignal): number {
  const encoded = encodeSignal(signal);
  const length = encoded.length;

  // Approximate capacity for alphanumeric mode with L error correction
  // (our base64 encoding uses alphanumeric characters)
  const capacities = [
    25,
    47,
    77,
    114,
    154,
    195,
    224,
    279,
    335,
    395, // 1-10
    468,
    535,
    619,
    667,
    758,
    854,
    938,
    1046,
    1153,
    1249, // 11-20
    1352,
    1460,
    1588,
    1704,
    1853,
    1990,
    2132,
    2223,
    2369,
    2520, // 21-30
    2677,
    2840,
    3009,
    3183,
    3351,
    3537,
    3729,
    3927,
    4087,
    4296, // 31-40
  ];

  for (let version = 0; version < capacities.length; version++) {
    if (length <= capacities[version]) {
      return version + 1;
    }
  }

  return 40; // Max version
}

/**
 * Signaling helper for establishing WebRTC connection via QR codes.
 *
 * Workflow:
 * 1. Initiator creates offer, collects candidates, generates QR code
 * 2. Responder scans QR code, creates answer, generates response QR code
 * 3. Initiator scans response QR code, connection establishes
 */
export class QrSignaling {
  private sessionId: string;

  constructor(sessionId?: string) {
    this.sessionId = sessionId ?? generateSessionId();
  }

  /**
   * Get the session ID.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Create a QR code payload from signaling data.
   */
  createPayload(
    role: PeerRole,
    description: SessionDescription,
    candidates: IceCandidate[],
  ): string {
    const signal = createCompressedSignal(this.sessionId, role, description, candidates);
    return encodeSignal(signal);
  }

  /**
   * Parse a QR code payload.
   */
  parsePayload(payload: string): {
    sessionId: string;
    role: PeerRole;
    description: SessionDescription;
    candidates: IceCandidate[];
  } {
    const signal = decodeSignal(payload);
    return parseCompressedSignal(signal);
  }

  /**
   * Verify that a parsed signal matches this session.
   */
  verifySession(parsedSessionId: string): boolean {
    return parsedSessionId === this.sessionId;
  }
}
