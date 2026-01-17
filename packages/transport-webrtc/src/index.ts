/**
 * @statewalker/vcs-transport-webrtc
 *
 * WebRTC transport layer for peer-to-peer Git synchronization.
 *
 * This package provides tools for establishing WebRTC data channel connections
 * and adapting them to the TransportConnection interface used by the Git
 * protocol implementation.
 *
 * Features:
 * - WebRTC DataChannel to TransportConnection adapter
 * - Peer connection lifecycle management
 * - QR code-based serverless signaling
 * - Compact signal compression for QR codes
 *
 * @example Basic usage with manual signaling:
 * ```typescript
 * import { PeerManager, WebRtcStream, waitForConnection } from "@statewalker/vcs-transport-webrtc";
 *
 * // Initiator side
 * const initiator = new PeerManager("initiator");
 * initiator.on("signal", (msg) => sendToPeer(msg));
 * await initiator.connect();
 *
 * // Responder side
 * const responder = new PeerManager("responder");
 * responder.on("signal", (msg) => sendToPeer(msg));
 * await responder.handleSignal(offerFromInitiator);
 *
 * // Wait for connection and create transport
 * const channel = await waitForConnection(manager);
 * const transport = createWebRtcStream(channel);
 * ```
 *
 * @example QR code signaling:
 * ```typescript
 * import { PeerManager, QrSignaling, waitForConnection } from "@statewalker/vcs-transport-webrtc";
 *
 * // Initiator: create offer QR code
 * const signaling = new QrSignaling();
 * const manager = new PeerManager("initiator");
 * await manager.connect();
 * await manager.waitForIceGathering();
 *
 * const qrPayload = signaling.createPayload(
 *   "initiator",
 *   manager.getLocalDescription()!,
 *   manager.getCollectedCandidates()
 * );
 * // Display qrPayload as QR code...
 *
 * // Responder: scan and respond
 * const { description, candidates } = signaling.parsePayload(scannedPayload);
 * for (const msg of [{ type: "offer", sdp: description.sdp }, ...candidates.map(c => ({ type: "candidate", candidate: c }))]) {
 *   await manager.handleSignal(msg);
 * }
 * ```
 *
 * @packageDocumentation
 */

// MessagePortLike adapter
export { createDataChannelPort, createDataChannelPortAsync } from "./datachannel-port.js";
export { PeerManager, waitForConnection } from "./peer-manager.js";
// Signaling utilities
export {
  createCompressedSignal,
  decodeSignal,
  encodeSignal,
  estimateQrVersion,
  generateSessionId,
  parseCompressedSignal,
  QrSignaling,
} from "./signaling.js";
// Types
export * from "./types.js";
// Core components
export { createWebRtcStream, WebRtcStream, type WebRtcStreamOptions } from "./webrtc-stream.js";
