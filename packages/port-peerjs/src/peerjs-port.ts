/**
 * PeerJS DataConnection adapter for MessagePortLike.
 *
 * Wraps a PeerJS DataConnection to provide the MessagePortLike interface,
 * enabling use with port-stream for Git protocol communication.
 */

import type { MessagePortLike } from "@statewalker/vcs-utils";
import type { DataConnection } from "peerjs";

/**
 * PeerJS port interface - MessagePortLike with bufferedAmount for backpressure.
 */
export interface PeerJsPort extends MessagePortLike {
  readonly bufferedAmount: number;
}

/**
 * Wrap a PeerJS DataConnection as MessagePortLike.
 *
 * IMPORTANT: The DataConnection should be created with { serialization: "raw" }
 * for binary data to work correctly.
 *
 * @param conn The PeerJS DataConnection to wrap
 * @returns MessagePortLike adapter with bufferedAmount support
 */
export function createPeerJsPort(conn: DataConnection): PeerJsPort {
  let started = false;

  const port: PeerJsPort = {
    onmessage: null,
    onclose: null,
    onerror: null,

    get isOpen() {
      return conn.open;
    },

    get bufferedAmount() {
      // Access internal RTCDataChannel for bufferedAmount
      const dc = (conn as unknown as { _dc?: RTCDataChannel })._dc;
      return dc?.bufferedAmount ?? 0;
    },

    postMessage(data: ArrayBuffer | Uint8Array) {
      if (!conn.open) {
        throw new Error("PeerJS connection is not open");
      }
      conn.send(data);
    },

    close() {
      conn.close();
    },

    start() {
      if (started) return;
      started = true;

      conn.on("data", (data: unknown) => {
        let buffer: ArrayBuffer;

        if (data instanceof ArrayBuffer) {
          buffer = data;
        } else if (data instanceof Uint8Array) {
          buffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer;
        } else if (ArrayBuffer.isView(data)) {
          buffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer;
        } else {
          // Fallback: encode as UTF-8
          buffer = new TextEncoder().encode(String(data)).buffer as ArrayBuffer;
        }

        port.onmessage?.({ data: buffer } as MessageEvent<ArrayBuffer>);
      });

      conn.on("close", () => port.onclose?.());
      conn.on("error", (err: Error) => port.onerror?.(err));
    },
  };

  return port;
}

/**
 * Create PeerJS port and wait for connection to open.
 *
 * @param conn The PeerJS DataConnection to wrap
 * @returns Promise resolving to PeerJsPort when connection is open
 */
export async function createPeerJsPortAsync(conn: DataConnection): Promise<PeerJsPort> {
  if (conn.open) {
    return createPeerJsPort(conn);
  }

  await new Promise<void>((resolve, reject) => {
    conn.on("open", () => resolve());
    conn.on("error", (err: Error) => reject(err));
  });

  return createPeerJsPort(conn);
}
