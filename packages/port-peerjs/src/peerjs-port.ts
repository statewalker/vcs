/**
 * PeerJS DataConnection adapter returning standard MessagePort.
 *
 * Bridges a PeerJS DataConnection to a MessagePort using the MessageChannel pattern,
 * enabling use with any code that expects standard MessagePort interface.
 */

import type { DataConnection } from "peerjs";

/**
 * Normalize incoming data to Uint8Array for MessagePort transport.
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
  // Fallback: encode as UTF-8
  return new TextEncoder().encode(String(data));
}

/**
 * Create a MessagePort that bridges to a PeerJS DataConnection.
 *
 * IMPORTANT: The DataConnection should be created with { serialization: "raw" }
 * for binary data to work correctly.
 *
 * This uses the MessageChannel bridge pattern:
 * - Creates a MessageChannel to get port1 and port2
 * - Returns port1 to the caller (standard MessagePort)
 * - Internally connects port2 to the DataConnection
 *
 * @param conn - The PeerJS DataConnection to wrap
 * @returns A standard MessagePort that bridges to the connection
 */
export function createPeerJsPort(conn: DataConnection): MessagePort {
  const { port1, port2 } = new MessageChannel();

  // port2 → DataConnection: forward messages to PeerJS
  port2.onmessage = (e: MessageEvent) => {
    if (!conn.open) return;
    // Send raw Uint8Array data
    const data = e.data instanceof Uint8Array ? e.data : normalizeToUint8Array(e.data);
    conn.send(data);
  };

  // DataConnection → port2: forward incoming data to the MessagePort
  conn.on("data", (data: unknown) => {
    const uint8 = normalizeToUint8Array(data);
    // Copy the data to avoid issues with detached buffers
    const copy = new Uint8Array(uint8);
    port2.postMessage(copy);
  });

  // Close port2 when connection closes to signal to port1 consumers
  conn.on("close", () => {
    // Send null to signal end of stream (convention used by messageport-adapters)
    try {
      port2.postMessage(null);
    } catch {
      // Ignore if already closed
    }
    port2.close();
  });

  // Start receiving messages on port2
  port2.start();

  return port1;
}

/**
 * Create a MessagePort and wait for the PeerJS connection to open.
 *
 * @param conn - The PeerJS DataConnection to wrap
 * @returns Promise resolving to MessagePort when connection is open
 */
export async function createPeerJsPortAsync(conn: DataConnection): Promise<MessagePort> {
  if (conn.open) {
    return createPeerJsPort(conn);
  }

  await new Promise<void>((resolve, reject) => {
    conn.on("open", () => resolve());
    conn.on("error", (err: Error) => reject(err));
  });

  return createPeerJsPort(conn);
}
