/**
 * MessagePort adapter functions for Git socket transport.
 *
 * These adapters bridge the MessagePort event-based API with async iteration
 * patterns using newAsyncGenerator. They provide:
 * - createMessagePortReader: converts MessagePort events to AsyncGenerator<Uint8Array>
 * - createMessagePortWriter: wraps postMessage with error handling and buffer transfer
 * - createMessagePortCloser: manages graceful shutdown with cleanup
 */

import { newAsyncGenerator } from "@statewalker/vcs-utils/streams";

/**
 * Create an AsyncGenerator that yields Uint8Array chunks from MessagePort messages.
 *
 * The adapter handles:
 * - Message event subscription
 * - Error propagation via messageerror event
 * - Port closure detection (null message)
 * - Backpressure via newAsyncGenerator
 *
 * @param port - The MessagePort to read from
 * @returns AsyncGenerator that yields Uint8Array chunks
 */
export function createMessagePortReader(port: MessagePort): AsyncGenerator<Uint8Array> {
  return newAsyncGenerator<Uint8Array>((next, done) => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;

      // Handle close signal (null or undefined)
      if (data === null || data === undefined) {
        done();
        return;
      }

      // Ensure data is Uint8Array
      if (!(data instanceof Uint8Array)) {
        done(new Error(`Invalid data type: expected Uint8Array, got ${typeof data}`));
        return;
      }

      next(data);
    };

    const handleError = (event: MessageEvent) => {
      done(event.data instanceof Error ? event.data : new Error("MessagePort error"));
    };

    port.addEventListener("message", handleMessage);
    port.addEventListener("messageerror", handleError);
    port.start();

    // Cleanup function
    return () => {
      port.removeEventListener("message", handleMessage);
      port.removeEventListener("messageerror", handleError);
    };
  });
}

/**
 * Create a write function for sending Uint8Array chunks via MessagePort.
 *
 * The adapter handles:
 * - Structured cloning of Uint8Array
 * - Transfer of underlying ArrayBuffer for zero-copy when the buffer is fully owned
 * - Error detection for closed ports
 *
 * @param port - The MessagePort to write to
 * @returns A function that writes Uint8Array data to the port
 */
export function createMessagePortWriter(port: MessagePort): (data: Uint8Array) => Promise<void> {
  let closed = false;

  return async (data: Uint8Array): Promise<void> => {
    if (closed) {
      throw new Error("MessagePort is closed");
    }

    try {
      // Transfer the buffer if the Uint8Array owns the entire buffer
      // This enables zero-copy transfer when possible
      // Clone otherwise to preserve caller's data for partial views
      const canTransfer = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;

      if (canTransfer) {
        port.postMessage(data, [data.buffer]);
      } else {
        port.postMessage(data);
      }
    } catch (err) {
      closed = true;
      throw new Error(
        `Failed to write to MessagePort: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}

/**
 * Create a close function for MessagePort.
 *
 * The adapter handles:
 * - Sending close signal (null message)
 * - Completing the async generator (via return)
 * - Closing the port
 * - Idempotent close (safe to call multiple times)
 *
 * @param port - The MessagePort to close
 * @param reader - The AsyncGenerator to complete
 * @returns A function that closes the port and reader
 */
export function createMessagePortCloser(
  port: MessagePort,
  reader: AsyncGenerator<Uint8Array>,
): () => Promise<void> {
  let closed = false;

  return async (): Promise<void> => {
    if (closed) return;
    closed = true;

    // Send close signal to peer
    try {
      port.postMessage(null);
    } catch {
      // Ignore errors if port already closed
    }

    // Complete the async generator
    try {
      await reader.return(undefined);
    } catch {
      // Ignore errors from generator cleanup
    }

    // Close the port
    port.close();
  };
}

/**
 * Create a pair of connected MessagePorts for testing or in-process communication.
 *
 * @returns A tuple of two connected MessagePort instances
 */
export function createMessagePortPair(): [MessagePort, MessagePort] {
  const channel = new MessageChannel();
  return [channel.port1, channel.port2];
}
