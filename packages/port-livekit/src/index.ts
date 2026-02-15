/**
 * @statewalker/vcs-port-livekit
 *
 * LiveKit MessagePort adapter for VCS transport.
 *
 * This package bridges LiveKit Room data channels to standard MessagePort,
 * enabling use with createGitSocketClient or any MessagePort-based transport.
 *
 * LiveKit uses a room-based pub/sub model (unlike PeerJS's direct P2P channels).
 * This adapter creates per-participant MessagePort bridges by filtering data
 * events by participant identity.
 *
 * @example Basic usage with Git socket client:
 * ```typescript
 * import { createLiveKitPort, RoomManager } from "@statewalker/vcs-port-livekit";
 * import { createMessagePortDuplex } from "@statewalker/vcs-transport-adapters";
 *
 * const manager = new RoomManager();
 * await manager.connect({ url: "ws://localhost:7880", token });
 *
 * // Create MessagePort for a specific participant
 * const port = createLiveKitPort(manager.getRoom(), "peer-identity");
 *
 * // Use with MessagePort duplex adapter for Git transport
 * const duplex = createMessagePortDuplex(port);
 * ```
 *
 * @packageDocumentation
 */

export { createLiveKitPort, createLiveKitPortAsync } from "./livekit-port.js";
export { RoomManager } from "./room-manager.js";
export type {
  LiveKitPortOptions,
  ParticipantInfo,
  RoomConnectionOptions,
  RoomManagerEvents,
} from "./types.js";
