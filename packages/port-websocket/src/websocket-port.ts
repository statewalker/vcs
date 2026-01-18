/**
 * WebSocket adapter for MessagePortLike.
 *
 * Wraps a WebSocket to provide the MessagePortLike interface,
 * enabling use with port-stream for Git protocol communication.
 */

import type { MessagePortLike } from "@statewalker/vcs-utils";

/**
 * Options for creating a WebSocket port.
 */
export interface WebSocketPortOptions {
  /** Binary type for WebSocket. Default: "arraybuffer" */
  binaryType?: BinaryType;
}

/**
 * WebSocket port interface - MessagePortLike with bufferedAmount for backpressure.
 */
export interface WebSocketPort extends MessagePortLike {
  readonly bufferedAmount: number;
}

/**
 * Wrap a WebSocket as MessagePortLike.
 *
 * The WebSocket should be in OPEN state, or handlers will be set up
 * to wait for it to open.
 *
 * @param ws The WebSocket to wrap
 * @param options Configuration options
 * @returns MessagePortLike adapter with bufferedAmount support
 */
export function createWebSocketPort(
  ws: WebSocket,
  options: WebSocketPortOptions = {},
): WebSocketPort {
  let started = false;

  const port: WebSocketPort = {
    onmessage: null,
    onclose: null,
    onerror: null,

    get isOpen() {
      return ws.readyState === WebSocket.OPEN;
    },

    get bufferedAmount() {
      return ws.bufferedAmount;
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
      if (started) return;
      started = true;

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
 * @returns Promise resolving to WebSocketPort when connected
 */
export async function createWebSocketPortAsync(
  url: string,
  protocols?: string | string[],
): Promise<WebSocketPort> {
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
 * @returns WebSocketPort adapter
 * @throws Error if WebSocket is not in OPEN state
 */
export function createWebSocketPortFromOpen(
  ws: WebSocket,
  options: WebSocketPortOptions = {},
): WebSocketPort {
  if (ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket must be in OPEN state");
  }
  return createWebSocketPort(ws, options);
}
