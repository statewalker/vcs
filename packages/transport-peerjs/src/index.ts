/**
 * @statewalker/vcs-transport-peerjs
 *
 * PeerJS transport layer for peer-to-peer Git synchronization.
 *
 * This package provides a PeerJS DataConnection adapter for the MessagePortLikeExtended
 * interface, enabling use with MessagePortStream for Git protocol communication
 * over PeerJS connections.
 *
 * @example Basic usage with MessagePortStream:
 * ```typescript
 * import { createPeerJsPortAsync } from "@statewalker/vcs-transport-peerjs";
 * import { createMessagePortStream } from "@statewalker/vcs-transport";
 * import Peer from "peerjs";
 *
 * const peer = new Peer();
 * const conn = peer.connect(remotePeerId, { serialization: "raw", reliable: true });
 *
 * // Wait for connection and create transport
 * const port = await createPeerJsPortAsync(conn);
 * const transport = createMessagePortStream(port);
 *
 * // Use transport for Git operations
 * await transport.send(packets);
 * for await (const packet of transport.receive()) {
 *   // Handle incoming packets
 * }
 * ```
 *
 * @example Convenience wrapper:
 * ```typescript
 * import { createPeerJsStream } from "@statewalker/vcs-transport-peerjs";
 * import Peer from "peerjs";
 *
 * const peer = new Peer();
 * const conn = peer.connect(remotePeerId, { serialization: "raw", reliable: true });
 *
 * conn.on("open", () => {
 *   const transport = createPeerJsStream(conn);
 *   // Use transport...
 * });
 * ```
 *
 * @packageDocumentation
 */

// MessagePortLike adapter
export { createPeerJsPort, createPeerJsPortAsync } from "./peerjs-port.js";

// Convenience wrapper
export { createPeerJsStream, PeerJsStream, type PeerJsStreamOptions } from "./peerjs-stream.js";
