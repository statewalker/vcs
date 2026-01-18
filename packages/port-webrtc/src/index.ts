/**
 * @statewalker/vcs-port-webrtc
 *
 * WebRTC MessagePortLike adapter for VCS transport.
 *
 * This package provides tools for establishing WebRTC data channel connections
 * and adapting them to the MessagePortLike interface for use with createPortStream
 * or createPortTransportConnection.
 *
 * Features:
 * - RTCDataChannel to MessagePortLike adapter
 * - Peer connection lifecycle management
 * - QR code-based serverless signaling
 * - Compact signal compression for QR codes
 *
 * @example Basic usage with createPortStream:
 * ```typescript
 * import { createDataChannelPortAsync, PeerManager, waitForConnection } from "@statewalker/vcs-port-webrtc";
 * import { createPortStream } from "@statewalker/vcs-utils";
 *
 * // Create peer connection
 * const manager = new PeerManager("initiator");
 * manager.on("signal", (msg) => sendToPeer(msg));
 * await manager.connect();
 *
 * // Wait for connection and create stream
 * const channel = await waitForConnection(manager);
 * const port = createDataChannelPortAsync(channel);
 * const stream = createPortStream(port);
 * ```
 *
 * @example QR code signaling:
 * ```typescript
 * import { PeerManager, QrSignaling } from "@statewalker/vcs-port-webrtc";
 *
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
 * ```
 *
 * @packageDocumentation
 */

export type { MessagePortLike } from "@statewalker/vcs-utils";
export {
  createDataChannelPort,
  createDataChannelPortAsync,
  type DataChannelPort,
} from "./datachannel-port.js";
export { PeerManager, waitForConnection } from "./peer-manager.js";
export {
  createCompressedSignal,
  decodeSignal,
  encodeSignal,
  estimateQrVersion,
  generateSessionId,
  parseCompressedSignal,
  QrSignaling,
} from "./signaling.js";
export * from "./types.js";
