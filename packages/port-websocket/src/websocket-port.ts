/**
 * WebSocket adapter returning standard MessagePort.
 *
 * Bridges a WebSocket to a MessagePort using the MessageChannel pattern,
 * enabling use with any code that expects standard MessagePort interface.
 */

/**
 * Options for creating a WebSocket port.
 */
export interface WebSocketPortOptions {
  /** Binary type for WebSocket. Default: "arraybuffer" */
  binaryType?: BinaryType;
}

/**
 * Normalize data to Uint8Array for MessagePort transport.
 */
function normalizeToUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  // Fallback: encode as UTF-8
  return new TextEncoder().encode(String(data));
}

/**
 * Create a MessagePort that bridges to a WebSocket.
 *
 * The WebSocket should be in OPEN state, or handlers will be set up
 * to wait for it to open.
 *
 * This uses the MessageChannel bridge pattern:
 * - Creates a MessageChannel to get port1 and port2
 * - Returns port1 to the caller (standard MessagePort)
 * - Internally connects port2 to the WebSocket
 *
 * @param ws - The WebSocket to wrap
 * @param options - Configuration options
 * @returns A standard MessagePort that bridges to the WebSocket
 */
export function createWebSocketPort(
  ws: WebSocket,
  options: WebSocketPortOptions = {},
): MessagePort {
  const { port1, port2 } = new MessageChannel();

  // Configure WebSocket for binary data
  ws.binaryType = options.binaryType ?? "arraybuffer";

  // port2 → WebSocket: forward messages to WebSocket
  port2.onmessage = (e: MessageEvent) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    // Send raw Uint8Array data
    const data = e.data instanceof Uint8Array ? e.data : normalizeToUint8Array(e.data);
    ws.send(data);
  };

  // WebSocket → port2: forward incoming data to the MessagePort
  ws.onmessage = (e: MessageEvent) => {
    if (e.data instanceof ArrayBuffer) {
      // Copy the data to avoid issues with detached buffers
      const copy = new Uint8Array(new Uint8Array(e.data));
      port2.postMessage(copy);
    } else if (e.data instanceof Blob) {
      // Convert Blob to ArrayBuffer asynchronously
      e.data.arrayBuffer().then((buffer) => {
        const copy = new Uint8Array(new Uint8Array(buffer));
        port2.postMessage(copy);
      });
    } else if (typeof e.data === "string") {
      const uint8 = new TextEncoder().encode(e.data);
      port2.postMessage(uint8);
    }
  };

  // Close port2 when WebSocket closes to signal to port1 consumers
  ws.onclose = () => {
    // Send null to signal end of stream (convention used by messageport-adapters)
    try {
      port2.postMessage(null);
    } catch {
      // Ignore if already closed
    }
    port2.close();
  };

  // Start receiving messages on port2
  port2.start();

  return port1;
}

/**
 * Create a MessagePort and wait for the WebSocket connection to open.
 *
 * @param url - The WebSocket URL to connect to
 * @param protocols - Optional subprotocols
 * @returns Promise resolving to MessagePort when connected
 */
export async function createWebSocketPortAsync(
  url: string,
  protocols?: string | string[],
): Promise<MessagePort> {
  const ws = new WebSocket(url, protocols);
  ws.binaryType = "arraybuffer";

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`Failed to connect to ${url}`));
  });

  return createWebSocketPort(ws);
}

/**
 * Create a MessagePort from an existing WebSocket that is already open.
 *
 * @param ws - The open WebSocket
 * @param options - Configuration options
 * @returns A standard MessagePort that bridges to the WebSocket
 * @throws Error if WebSocket is not in OPEN state
 */
export function createWebSocketPortFromOpen(
  ws: WebSocket,
  options: WebSocketPortOptions = {},
): MessagePort {
  if (ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket must be in OPEN state");
  }
  return createWebSocketPort(ws, options);
}
