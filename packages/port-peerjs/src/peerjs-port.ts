/**
 * PeerJS DataConnection adapter returning standard MessagePort.
 *
 * Bridges a PeerJS DataConnection to a MessagePort using the MessageChannel pattern,
 * enabling use with any code that expects standard MessagePort interface.
 */

import type { DataConnection } from "peerjs";

/**
 * Cache of existing ports to ensure only one MessagePort is created per connection.
 * This prevents multiple listeners being added to the same connection.
 */
const connectionPorts = new WeakMap<DataConnection, MessagePort>();

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
 * NOTE: This function returns the SAME port if called multiple times with the
 * same connection. This prevents multiple data listeners being added to the
 * connection, which would cause messages to be delivered to multiple consumers.
 *
 * @param conn - The PeerJS DataConnection to wrap
 * @returns A standard MessagePort that bridges to the connection
 */
export function createPeerJsPort(conn: DataConnection): MessagePort {
  // Return existing port if one was already created for this connection
  const existingPort = connectionPorts.get(conn);
  if (existingPort) {
    return existingPort;
  }

  const { port1, port2 } = new MessageChannel();

  // port2 → DataConnection: forward messages to PeerJS
  port2.onmessage = (e: MessageEvent) => {
    if (!conn.open) {
      return;
    }
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
    // Remove from cache
    connectionPorts.delete(conn);
  });

  const nativeClose = port1.close.bind(port1);
  port1.close = () => {
    // Close the PeerJS connection when port1 is closed
    if (conn.open) {
      conn.close();
    }
    nativeClose();
    // Remove from cache
    connectionPorts.delete(conn);
  };

  // Start receiving messages on port2
  port2.start();

  // Cache the port
  connectionPorts.set(conn, port1);

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
