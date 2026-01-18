/**
 * @statewalker/vcs-port-peerjs
 *
 * PeerJS MessagePortLike adapter for VCS transport.
 *
 * This package provides a PeerJS DataConnection adapter for the MessagePortLike
 * interface, enabling use with createPortStream or createPortTransportConnection
 * for Git protocol communication over PeerJS connections.
 *
 * @example Basic usage with createPortStream:
 * ```typescript
 * import { createPeerJsPortAsync } from "@statewalker/vcs-port-peerjs";
 * import { createPortStream } from "@statewalker/vcs-utils";
 * import Peer from "peerjs";
 *
 * const peer = new Peer();
 * const conn = peer.connect(remotePeerId, { serialization: "raw", reliable: true });
 *
 * // Wait for connection and create stream
 * const port = await createPeerJsPortAsync(conn);
 * const stream = createPortStream(port);
 *
 * // Send binary data with ACK-based backpressure
 * await stream.send(asyncIterableOfUint8Array);
 *
 * // Receive binary data
 * for await (const chunk of stream.receive()) {
 *   // Handle incoming chunks
 * }
 * ```
 *
 * @example With TransportConnection for Git protocol:
 * ```typescript
 * import { createPeerJsPortAsync } from "@statewalker/vcs-port-peerjs";
 * import { createPortTransportConnection } from "@statewalker/vcs-transport";
 * import Peer from "peerjs";
 *
 * const peer = new Peer();
 * const conn = peer.connect(remotePeerId, { serialization: "raw", reliable: true });
 *
 * const port = await createPeerJsPortAsync(conn);
 * const transport = createPortTransportConnection(port);
 *
 * // Use transport for Git operations
 * await transport.send(packets);
 * for await (const packet of transport.receive()) {
 *   // Handle incoming packets
 * }
 * ```
 *
 * @packageDocumentation
 */

export type { MessagePortLike } from "@statewalker/vcs-utils";
export { createPeerJsPort, createPeerJsPortAsync, type PeerJsPort } from "./peerjs-port.js";
