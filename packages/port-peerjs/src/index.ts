/**
 * @statewalker/vcs-port-peerjs
 *
 * PeerJS MessagePort adapter for VCS transport.
 *
 * This package bridges PeerJS DataConnection to standard MessagePort,
 * enabling use with createGitSocketClient or any MessagePort-based transport.
 *
 * @example Basic usage with Git socket client:
 * ```typescript
 * import { createPeerJsPortAsync } from "@statewalker/vcs-port-peerjs";
 * import { createGitSocketClient } from "@statewalker/vcs-transport";
 * import Peer from "peerjs";
 *
 * const peer = new Peer();
 * const conn = peer.connect(remotePeerId, { serialization: "raw", reliable: true });
 *
 * // Wait for connection and create MessagePort
 * const port = await createPeerJsPortAsync(conn);
 *
 * // Use with Git socket client for P2P Git operations
 * const client = createGitSocketClient(port, {
 *   path: "/repo.git",
 *   service: "git-upload-pack"
 * });
 *
 * const refs = await client.discoverRefs();
 * ```
 *
 * @packageDocumentation
 */

export { createPeerJsPort, createPeerJsPortAsync } from "./peerjs-port.js";
