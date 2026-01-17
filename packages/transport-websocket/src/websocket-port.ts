/**
 * WebSocket adapter for MessagePortLikeExtended.
 *
 * Wraps a WebSocket to provide the MessagePortLikeExtended interface,
 * enabling use with MessagePortStream for Git protocol communication.
 */

import type { MessagePortLikeExtended } from "@statewalker/vcs-transport";

/**
 * Options for creating a WebSocket port.
 */
export interface WebSocketPortOptions {
  /** Binary type for WebSocket. Default: "arraybuffer" */
  binaryType?: BinaryType;
}

/**
 * Wrap a WebSocket as MessagePortLikeExtended.
 *
 * The WebSocket should be in OPEN state, or handlers will be set up
 * to wait for it to open.
 *
 * @param ws The WebSocket to wrap
 * @param options Configuration options
 * @returns MessagePortLikeExtended adapter
 */
export function createWebSocketPort(
  ws: WebSocket,
  options: WebSocketPortOptions = {},
): MessagePortLikeExtended {
  const port: MessagePortLikeExtended = {
    onmessage: null,
    onmessageerror: null,
    onclose: null,
    onerror: null,

    get bufferedAmount() {
      return ws.bufferedAmount;
    },

    get isOpen() {
      return ws.readyState === WebSocket.OPEN;
    },

    postMessage(data: ArrayBuffer | Uint8Array) {
      if (ws.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket is not open");
      }
      ws.send(data);
    },

    close() {
      ws.close();
    },

    start() {
      ws.binaryType = options.binaryType ?? "arraybuffer";

      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          port.onmessage?.({ data: e.data } as MessageEvent<ArrayBuffer>);
        } else if (e.data instanceof Blob) {
          // Convert Blob to ArrayBuffer
          e.data.arrayBuffer().then((buffer) => {
            port.onmessage?.({ data: buffer } as MessageEvent<ArrayBuffer>);
          });
        } else if (typeof e.data === "string") {
          // Convert string to ArrayBuffer
          const buffer = new TextEncoder().encode(e.data).buffer;
          port.onmessage?.({ data: buffer as ArrayBuffer } as MessageEvent<ArrayBuffer>);
        }
      };

      ws.onclose = () => port.onclose?.();
      ws.onerror = () => port.onerror?.(new Error("WebSocket error"));
    },
  };

  return port;
}

/**
 * Create WebSocket port and wait for connection to open.
 *
 * @param url The WebSocket URL to connect to
 * @param protocols Optional subprotocols
 * @returns Promise resolving to MessagePortLikeExtended when connected
 */
export async function createWebSocketPortAsync(
  url: string,
  protocols?: string | string[],
): Promise<MessagePortLikeExtended> {
  const ws = new WebSocket(url, protocols);
  ws.binaryType = "arraybuffer";

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`Failed to connect to ${url}`));
  });

  return createWebSocketPort(ws);
}

/**
 * Create WebSocket port from an existing WebSocket that is already open.
 *
 * @param ws The open WebSocket
 * @param options Configuration options
 * @returns MessagePortLikeExtended adapter
 * @throws Error if WebSocket is not in OPEN state
 */
export function createWebSocketPortFromOpen(
  ws: WebSocket,
  options: WebSocketPortOptions = {},
): MessagePortLikeExtended {
  if (ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket must be in OPEN state");
  }
  return createWebSocketPort(ws, options);
}
