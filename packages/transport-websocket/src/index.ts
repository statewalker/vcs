/**
 * @statewalker/vcs-transport-websocket
 *
 * WebSocket transport layer for Git synchronization.
 *
 * This package provides a WebSocket adapter for the MessagePortLikeExtended
 * interface, enabling use with MessagePortStream for Git protocol communication
 * over WebSocket connections.
 *
 * @example Basic usage:
 * ```typescript
 * import { createWebSocketPortAsync } from "@statewalker/vcs-transport-websocket";
 * import { createMessagePortStream } from "@statewalker/vcs-transport";
 *
 * // Connect to WebSocket server
 * const port = await createWebSocketPortAsync("wss://example.com/git");
 *
 * // Create transport stream
 * const transport = createMessagePortStream(port);
 *
 * // Use transport for Git operations
 * await transport.send(packets);
 * for await (const packet of transport.receive()) {
 *   // Handle incoming packets
 * }
 * ```
 *
 * @example With existing WebSocket:
 * ```typescript
 * import { createWebSocketPort } from "@statewalker/vcs-transport-websocket";
 * import { createMessagePortStream } from "@statewalker/vcs-transport";
 *
 * const ws = new WebSocket("wss://example.com/git");
 * ws.onopen = () => {
 *   const port = createWebSocketPort(ws);
 *   const transport = createMessagePortStream(port);
 *   // Use transport...
 * };
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
