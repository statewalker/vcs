/**
 * MessagePort to Duplex adapter with service handshake protocol.
 *
 * Identical to the webrtc-p2p-sync version — shared close marker [0x00, 0xFF]
 * and 1-byte service handshake for multiplexed operations.
 */

import type { Duplex } from "@statewalker/vcs-transport";

export type GitServiceType = "git-upload-pack" | "git-receive-pack";

const SERVICE_UPLOAD_PACK = 0x01;
const SERVICE_RECEIVE_PACK = 0x02;

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

export function createMessagePortClientDuplex(port: MessagePort, service: GitServiceType): Duplex {
  const duplex = createMessagePortDuplex(port);
  port.postMessage(serviceToBytes(service));
  return duplex;
}

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

      if (
        bytes.length !== 1 ||
        (bytes[0] !== SERVICE_UPLOAD_PACK && bytes[0] !== SERVICE_RECEIVE_PACK)
      ) {
        return;
      }

      port.removeEventListener("message", onMessage);
      const service = bytesToService(bytes[0]);
      const duplex = createMessagePortDuplex(port);
      resolve({ duplex, service });
    };

    port.addEventListener("message", onMessage);
    port.start();
  });
}
