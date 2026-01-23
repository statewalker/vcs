/**
 * @statewalker/vcs-port-websocket
 *
 * WebSocket MessagePort adapter for VCS transport.
 *
 * This package bridges WebSocket to standard MessagePort,
 * enabling use with createGitSocketClient or any MessagePort-based transport.
 *
 * @example Basic usage with Git socket client:
 * ```typescript
 * import { createWebSocketPortAsync } from "@statewalker/vcs-port-websocket";
 * import { createGitSocketClient } from "@statewalker/vcs-transport";
 *
 * // Connect to WebSocket server
 * const port = await createWebSocketPortAsync("wss://example.com/git");
 *
 * // Use with Git socket client
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

export {
  createWebSocketPort,
  createWebSocketPortAsync,
  createWebSocketPortFromOpen,
  type WebSocketPortOptions,
} from "./websocket-port.js";
