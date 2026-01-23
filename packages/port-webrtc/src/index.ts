/**
 * @statewalker/vcs-port-webrtc
 *
 * WebRTC MessagePort adapter for VCS transport.
 *
 * This package provides tools for establishing WebRTC data channel connections
 * and adapting them to standard MessagePort for use with createGitSocketClient
 * or any MessagePort-based transport.
 *
 * Features:
 * - RTCDataChannel to MessagePort adapter
 * - Peer connection lifecycle management
 * - QR code-based serverless signaling
 * - Compact signal compression for QR codes
 *
 * @example Basic usage with Git socket client:
 * ```typescript
 * import { createDataChannelPortAsync, PeerManager, waitForConnection } from "@statewalker/vcs-port-webrtc";
 * import { createGitSocketClient } from "@statewalker/vcs-transport";
 *
 * // Create peer connection
 * const manager = new PeerManager("initiator");
 * manager.on("signal", (msg) => sendToPeer(msg));
 * await manager.connect();
 *
 * // Wait for connection and create MessagePort
 * const channel = await waitForConnection(manager);
 * const port = await createDataChannelPortAsync(channel);
 *
 * // Use with Git socket client
 * const client = createGitSocketClient(port, {
 *   path: "/repo.git",
 *   service: "git-upload-pack"
 * });
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

export { createDataChannelPort, createDataChannelPortAsync } from "./datachannel-port.js";
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
