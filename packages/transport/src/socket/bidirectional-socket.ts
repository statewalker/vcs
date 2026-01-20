/**
 * BidirectionalSocket implementation over MessagePortLike.
 *
 * Provides symmetric read/write/close interface for bidirectional byte streams.
 * Uses the port-stream protocol from @statewalker/vcs-utils for ACK-based
 * backpressure.
 */

import {
  type MessagePortLike,
  readStream,
  wrapNativePort,
  writeStream,
} from "@statewalker/vcs-utils";
import type { BidirectionalSocket, BidirectionalSocketOptions } from "./types.js";

/**
 * Create a queue-based async generator that can be fed values imperatively.
 *
 * Returns the generator and control functions (push, end) that can be used
 * to add values to the stream.
 */
function createPushableGenerator(): {
  generator: AsyncIterable<Uint8Array>;
  push: (data: Uint8Array) => Promise<void>;
  end: () => void;
} {
  type QueueItem =
    | { type: "data"; data: Uint8Array; resolve: () => void; reject: (err: Error) => void }
    | { type: "end" };

  const queue: QueueItem[] = [];
  let waiter: (() => void) | null = null;
  let ended = false;

  const generator: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          while (true) {
            if (queue.length > 0) {
              const item = queue.shift();
              if (!item || item.type === "end") {
                return { done: true, value: undefined };
              }
              // Resolve the push promise to signal the data was consumed
              item.resolve();
              return { done: false, value: item.data };
            }

            if (ended) {
              return { done: true, value: undefined };
            }

            // Wait for more data
            await new Promise<void>((resolve) => {
              waiter = resolve;
            });
            waiter = null;
          }
        },
        async return(): Promise<IteratorResult<Uint8Array>> {
          ended = true;
          // Reject any pending pushes
          for (const item of queue) {
            if (item.type === "data") {
              item.reject(new Error("Generator closed"));
            }
          }
          queue.length = 0;
          waiter?.();
          return { done: true, value: undefined };
        },
      };
    },
  };

  const push = (data: Uint8Array): Promise<void> => {
    if (ended) {
      return Promise.reject(new Error("Cannot push: generator ended"));
    }
    return new Promise<void>((resolve, reject) => {
      queue.push({ type: "data", data, resolve, reject });
      waiter?.();
    });
  };

  const end = (): void => {
    if (ended) return;
    ended = true;
    queue.push({ type: "end" });
    waiter?.();
  };

  return { generator, push, end };
}

/**
 * Create a BidirectionalSocket from a MessagePortLike.
 *
 * The socket provides:
 * - read(): AsyncIterable for receiving data from remote
 * - write(data): Promise for sending data to remote
 * - close(): Promise for cleanly closing the connection
 *
 * @param port MessagePortLike for communication
 * @param options Configuration options
 * @returns BidirectionalSocket interface
 */
export function createBidirectionalSocket(
  port: MessagePortLike,
  options: BidirectionalSocketOptions = {},
): BidirectionalSocket {
  // OUTPUT: Create pushable generator for writing
  const { generator: outputGenerator, push, end } = createPushableGenerator();

  let writeError: Error | undefined;
  let closed = false;

  // Start writeStream - runs in background
  // We catch errors but don't propagate timeout errors during close
  const writePromise = writeStream(port, outputGenerator, options).catch((err) => {
    if (!closed) {
      writeError = err instanceof Error ? err : new Error(String(err));
    }
  });

  // INPUT: Read from port with eager start
  // We need to start consuming the readStream immediately so it can respond to ACKs
  const inputStream = readStream(port);
  const inputIterator = inputStream[Symbol.asyncIterator]();

  // Buffer for eagerly read data
  const inputBuffer: Uint8Array[] = [];
  let inputDone = false;
  let inputError: Error | undefined;
  let inputWaiter: (() => void) | null = null;

  // Start reading eagerly in the background
  // Note: we continue reading even after closed is set, to drain any remaining data
  const startEagerRead = async () => {
    try {
      while (true) {
        const result = await inputIterator.next();
        if (result.done) {
          inputDone = true;
          inputWaiter?.();
          break;
        }
        inputBuffer.push(result.value);
        inputWaiter?.();
      }
    } catch (err) {
      // Only treat as error if not closed (port close causes errors)
      if (!closed) {
        inputError = err instanceof Error ? err : new Error(String(err));
      } else {
        inputDone = true;
      }
      inputWaiter?.();
    }
  };

  // Start the eager read
  startEagerRead();

  // Create a lazy iterable that reads from the buffer
  // Note: we continue reading even after socket is closed (closed flag) until
  // we receive END from remote (inputDone flag) or there's an error
  const bufferedInput: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          while (true) {
            if (inputError) {
              throw inputError;
            }
            if (inputBuffer.length > 0) {
              const value = inputBuffer.shift();
              if (value) {
                return { done: false, value };
              }
            }
            // Only return done when we've received END from remote
            if (inputDone) {
              return { done: true, value: undefined };
            }
            // Wait for more data (or inputDone to become true)
            await new Promise<void>((resolve) => {
              inputWaiter = resolve;
            });
            inputWaiter = null;
          }
        },
      };
    },
  };

  return {
    read(): AsyncIterable<Uint8Array> {
      return bufferedInput;
    },

    async write(data: Uint8Array): Promise<void> {
      if (closed) {
        throw new Error("Cannot write: socket closed");
      }
      if (writeError) {
        throw writeError;
      }
      await push(data);
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;

      // Signal end of output stream
      end();

      // Wait for writeStream to complete (or timeout)
      // Longer timeout to allow bidirectional communication to complete
      const timeout = options.ackTimeout ?? 5000;
      await Promise.race([writePromise, new Promise((resolve) => setTimeout(resolve, timeout))]);

      // Mark input as done if not already (port close will cause this naturally)
      if (!inputDone) {
        inputDone = true;
        inputWaiter?.();
      }

      // Close the underlying port
      port.close();
    },
  };
}

/**
 * Create a pair of connected BidirectionalSockets for testing or in-process communication.
 *
 * Uses MessageChannel to create two connected ports, then wraps each in a
 * BidirectionalSocket. Data written to one socket can be read from the other.
 *
 * @param options Configuration options applied to both sockets
 * @returns Tuple of two connected BidirectionalSocket instances
 */
export function createBidirectionalSocketPair(
  options?: BidirectionalSocketOptions,
): [BidirectionalSocket, BidirectionalSocket] {
  const channel = new MessageChannel();
  return [
    createBidirectionalSocket(wrapNativePort(channel.port1), options),
    createBidirectionalSocket(wrapNativePort(channel.port2), options),
  ];
}
