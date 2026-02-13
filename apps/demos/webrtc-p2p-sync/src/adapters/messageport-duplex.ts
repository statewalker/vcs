/**
 * MessagePort to Duplex adapter.
 *
 * Converts a MessagePort (from MessageChannel) into a Duplex stream
 * (async iterator + write) for use with the transport layer.
 *
 * Mirrors peerjs-duplex.ts but operates on MessagePort instead of
 * PeerJS DataConnection. The close marker protocol [0x00, 0xFF] is
 * preserved to delimit individual Git protocol operations on a shared port.
 */

import type { Duplex } from "@statewalker/vcs-transport";

/** Git service type (same as transport's ServiceType but not exported) */
export type GitServiceType = "git-upload-pack" | "git-receive-pack";

/** Service type byte encoding */
const SERVICE_UPLOAD_PACK = 0x01;
const SERVICE_RECEIVE_PACK = 0x02;

/**
 * Close marker sent through the port to signal duplex stream end.
 * Two bytes that cannot be confused with a service byte (1 byte: 0x01/0x02)
 * or pkt-line data (starts with 4 ASCII hex chars).
 */
const CLOSE_MARKER = new Uint8Array([0x00, 0xff]);

function isCloseMarker(data: Uint8Array): boolean {
  return data.length === 2 && data[0] === 0x00 && data[1] === 0xff;
}

function serviceToBytes(service: GitServiceType): Uint8Array {
  return new Uint8Array([
    service === "git-receive-pack" ? SERVICE_RECEIVE_PACK : SERVICE_UPLOAD_PACK,
  ]);
}

function bytesToService(byte: number): GitServiceType {
  return byte === SERVICE_RECEIVE_PACK ? "git-receive-pack" : "git-upload-pack";
}

/**
 * Create a Duplex stream from a MessagePort.
 *
 * The adapter queues incoming messages and yields them via the async iterator.
 * Writes are sent directly via port.postMessage().
 *
 * Does NOT call port.close() — the port is shared across operations.
 *
 * @param port - An active MessagePort
 * @returns Duplex interface for transport operations
 */
export function createMessagePortDuplex(port: MessagePort): Duplex {
  const incomingQueue: Uint8Array[] = [];
  let resolveNext: ((value: IteratorResult<Uint8Array>) => void) | null = null;
  let closed = false;
  let receivedProtocolData = false;

  const onMessage = (event: MessageEvent) => {
    const data = event.data;
    const chunk =
      data instanceof Uint8Array
        ? data
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data as ArrayBuffer);

    // Handle close signal from remote end.
    // Only honor close markers after receiving real protocol data.
    // Close markers that arrive before any data are stale leftovers
    // from a previous operation on the same shared port.
    if (isCloseMarker(chunk)) {
      if (!receivedProtocolData) return;
      closed = true;
      if (resolveNext) {
        resolveNext({ value: undefined as unknown as Uint8Array, done: true });
        resolveNext = null;
      }
      return;
    }

    receivedProtocolData = true;
    if (resolveNext) {
      resolveNext({ value: chunk, done: false });
      resolveNext = null;
    } else {
      incomingQueue.push(chunk);
    }
  };

  port.addEventListener("message", onMessage);
  port.start();

  return {
    async *[Symbol.asyncIterator]() {
      while (!closed) {
        if (incomingQueue.length > 0) {
          yield incomingQueue.shift() as Uint8Array;
        } else {
          const result = await new Promise<IteratorResult<Uint8Array>>((resolve) => {
            resolveNext = resolve;
          });
          if (result.done) return;
          yield result.value;
        }
      }
      // Drain any remaining queued data
      while (incomingQueue.length > 0) {
        yield incomingQueue.shift() as Uint8Array;
      }
    },

    write(data: Uint8Array) {
      if (!closed) {
        port.postMessage(data);
      }
    },

    async close() {
      if (closed) return;
      closed = true;
      // Signal the remote end before cleaning up
      try {
        port.postMessage(CLOSE_MARKER);
      } catch {
        // Port may already be closed
      }
      port.removeEventListener("message", onMessage);
      if (resolveNext) {
        resolveNext({ value: undefined as unknown as Uint8Array, done: true });
        resolveNext = null;
      }
    },
  };
}

/**
 * Create a client-side Duplex that sends a service-type handshake byte
 * before the Git protocol starts.
 *
 * The client creates the duplex (registering the message handler to capture
 * server responses), sends the service byte to trigger the server, then
 * returns the duplex for the FSM to use.
 *
 * @param port - MessagePort to communicate over
 * @param service - Git service type to request
 * @returns Duplex ready for fetchOverDuplex/pushOverDuplex
 */
export function createMessagePortClientDuplex(port: MessagePort, service: GitServiceType): Duplex {
  // Create duplex first (registers "message" handler to capture server responses)
  const duplex = createMessagePortDuplex(port);
  // Send service type byte to trigger the server
  port.postMessage(serviceToBytes(service));
  return duplex;
}

/**
 * Wait for a client to send a service-type handshake byte on a MessagePort,
 * then create a server-side Duplex and return the detected service.
 *
 * This ensures the server doesn't start writing (ref advertisement)
 * until the client is ready to receive.
 *
 * @param port - MessagePort to listen on
 * @returns Promise with the Duplex and detected service type
 */
export function waitForMessagePortClientService(
  port: MessagePort,
): Promise<{ duplex: Duplex; service: GitServiceType }> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      const bytes =
        data instanceof Uint8Array
          ? data
          : data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data as ArrayBuffer);

      // Ignore non-service data (e.g., close markers from previous operations).
      // A valid service handshake is exactly 1 byte: 0x01 or 0x02.
      if (
        bytes.length !== 1 ||
        (bytes[0] !== SERVICE_UPLOAD_PACK && bytes[0] !== SERVICE_RECEIVE_PACK)
      ) {
        return;
      }

      port.removeEventListener("message", onMessage);

      const service = bytesToService(bytes[0]);
      // Create the duplex AFTER consuming the service byte
      // so the FSM doesn't see it
      const duplex = createMessagePortDuplex(port);
      resolve({ duplex, service });
    };

    port.addEventListener("message", onMessage);
    port.start();
  });
}
