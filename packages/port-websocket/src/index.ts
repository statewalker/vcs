/**
 * @statewalker/vcs-port-websocket
 *
 * WebSocket MessagePortLike adapter for VCS transport.
 *
 * This package provides a WebSocket adapter for the MessagePortLike
 * interface, enabling use with createPortStream or createPortTransportConnection
 * for Git protocol communication over WebSocket connections.
 *
 * @example Basic usage with createPortStream:
 * ```typescript
 * import { createWebSocketPortAsync } from "@statewalker/vcs-port-websocket";
 * import { createPortStream } from "@statewalker/vcs-utils";
 *
 * // Connect to WebSocket server
 * const port = await createWebSocketPortAsync("wss://example.com/git");
 *
 * // Create bidirectional stream with ACK-based backpressure
 * const stream = createPortStream(port);
 *
 * // Send binary data
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
 * import { createWebSocketPortAsync } from "@statewalker/vcs-port-websocket";
 * import { createPortTransportConnection } from "@statewalker/vcs-transport";
 *
 * const port = await createWebSocketPortAsync("wss://example.com/git");
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
export {
  createWebSocketPort,
  createWebSocketPortAsync,
  createWebSocketPortFromOpen,
  type WebSocketPort,
  type WebSocketPortOptions,
} from "./websocket-port.js";
