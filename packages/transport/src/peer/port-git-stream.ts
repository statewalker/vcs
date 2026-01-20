/**
 * P2P Transport Bridge: MessagePort to GitBidirectionalStream.
 *
 * Converts MessagePortLike interfaces into Git protocol streams,
 * enabling P2P git communication over MessageChannel, WebRTC, etc.
 *
 * Uses ACK-based backpressure from port-stream for reliable flow control.
 */

import { type MessagePortLike, readStream, writeStream } from "@statewalker/vcs-utils";
import {
  createInputStreamFromAsyncIterable,
  createOutputStreamFromWritable,
  type GitBidirectionalStream,
} from "../streams/git-stream.js";

/**
 * Options for creating a Git stream from a MessagePort.
 */
export interface PortGitStreamOptions {
  /** Byte threshold for sub-stream splitting (default: 64KB) */
  chunkSize?: number;
  /** Timeout for ACK response in milliseconds (default: 30000) */
  ackTimeout?: number;
}

/**
 * Result of creating a Git stream from a port.
 */
export interface PortGitStreamResult {
  /** The bidirectional Git stream */
  stream: GitBidirectionalStream;
  /** Promise that resolves when output writing completes */
  writeCompletion: Promise<void>;
  /** Close the port and associated resources */
  closePort: () => void;
}

/**
 * Simple async queue for bridging push-based writes to pull-based iteration.
 */
interface AsyncQueue<T> {
  push(item: T): void;
  end(error?: Error): void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

/**
 * Create a simple async queue that can be pushed to and iterated over.
 */
function createAsyncQueue<T>(): AsyncQueue<T> {
  const items: T[] = [];
  let done = false;
  let error: Error | undefined;
  let resolveWait: (() => void) | undefined;

  return {
    push(item: T): void {
      if (done) return;
      items.push(item);
      if (resolveWait) {
        resolveWait();
        resolveWait = undefined;
      }
    },

    end(err?: Error): void {
      if (done) return;
      done = true;
      error = err;
      if (resolveWait) {
        resolveWait();
        resolveWait = undefined;
      }
    },

    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        async next(): Promise<IteratorResult<T>> {
          // Return items from queue
          if (items.length > 0) {
            const item = items.shift();
            if (item !== undefined) {
              return { value: item, done: false };
            }
          }

          // Check if we're done
          if (done) {
            if (error) {
              throw error;
            }
            return { value: undefined, done: true };
          }

          // Wait for more items
          await new Promise<void>((resolve) => {
            resolveWait = resolve;
          });

          // After waiting, check again
          if (items.length > 0) {
            const item = items.shift();
            if (item !== undefined) {
              return { value: item, done: false };
            }
          }

          if (done) {
            if (error) {
              throw error;
            }
            return { value: undefined, done: true };
          }

          // This shouldn't happen, but just in case
          return { value: undefined, done: true };
        },
      };
    },
  };
}

/**
 * Create a GitBidirectionalStream from a MessagePortLike.
 *
 * This bridges MessagePort-style communication to Git protocol streams,
 * allowing P2P git operations over any MessagePortLike transport.
 *
 * The returned stream provides:
 * - Input: Reads binary data from the port as a GitInputStream
 * - Output: Writes binary data to the port as a GitOutputStream
 *
 * Flow control is handled via ACK-based backpressure.
 *
 * @param port - MessagePortLike for communication
 * @param options - Configuration options
 * @returns Git bidirectional stream with completion tracking
 *
 * @example
 * ```typescript
 * const channel = new MessageChannel();
 * const port = wrapNativePort(channel.port1);
 * const { stream, writeCompletion, closePort } = createGitStreamFromPort(port);
 *
 * // Use stream for Git protocol communication
 * await stream.output.write(data);
 * for await (const chunk of stream.input) {
 *   // process chunk
 * }
 *
 * // Clean up
 * await stream.close();
 * await writeCompletion;
 * ```
 */
export function createGitStreamFromPort(
  port: MessagePortLike,
  options: PortGitStreamOptions = {},
): PortGitStreamResult {
  let closed = false;
  let portError: Error | undefined;

  // Error listener for the port
  const handleError = (error: Error) => {
    portError = error;
    outputQueue.end(error);
  };
  port.addEventListener("error", handleError);

  // Close listener for the port
  const handleClose = () => {
    closed = true;
    outputQueue.end();
  };
  port.addEventListener("close", handleClose);

  // INPUT: Read from port → GitInputStream
  const inputIterable = readStream(port);
  const input = createInputStreamFromAsyncIterable(
    wrapWithErrorCheck(inputIterable, () => portError),
  );

  // OUTPUT: GitOutputStream → Write to port via async queue
  const outputQueue = createAsyncQueue<Uint8Array>();

  // Start writing to port (runs in background)
  const writeCompletion = writeStream(port, outputQueue, options).catch((err) => {
    // Store error for input stream to detect
    if (!portError) {
      portError = err instanceof Error ? err : new Error(String(err));
    }
    throw err;
  });

  // Create GitOutputStream that pushes to the queue
  let outputClosed = false;
  const output = createOutputStreamFromWritable(
    async (data: Uint8Array) => {
      if (outputClosed) {
        throw new Error("Stream is closed");
      }
      if (portError) {
        throw portError;
      }
      if (closed) {
        throw new Error("Port is closed");
      }
      outputQueue.push(data);
    },
    async () => {
      if (outputClosed) return;
      outputClosed = true;
      outputQueue.end();
      // Wait for pending writes to complete
      try {
        await writeCompletion;
      } catch {
        // Ignore completion errors on close
      }
    },
  );

  // Create the bidirectional stream with custom close behavior
  const stream: GitBidirectionalStream = {
    input,
    output,
    async close(): Promise<void> {
      closed = true;
      outputQueue.end();
      await Promise.all([input.close(), output.close()]);
      port.removeEventListener("error", handleError);
      port.removeEventListener("close", handleClose);
    },
  };

  // Function to close the port
  const closePort = () => {
    closed = true;
    outputQueue.end();
    port.close();
  };

  return {
    stream,
    writeCompletion,
    closePort,
  };
}

/**
 * Wrap an async iterable to check for errors before yielding.
 */
async function* wrapWithErrorCheck<T>(
  iterable: AsyncIterable<T>,
  getError: () => Error | undefined,
): AsyncIterable<T> {
  for await (const item of iterable) {
    const error = getError();
    if (error) {
      throw error;
    }
    yield item;
  }
}

/**
 * Create a pair of connected GitBidirectionalStreams for testing.
 *
 * Creates a MessageChannel internally and returns two connected streams
 * that can communicate with each other.
 *
 * @param options - Configuration options
 * @returns Tuple of two connected Git bidirectional streams
 *
 * @example
 * ```typescript
 * const [streamA, streamB] = createGitStreamPair();
 *
 * // Run client and server concurrently
 * await Promise.all([
 *   clientOperation(streamA),
 *   serverOperation(streamB),
 * ]);
 * ```
 */
export function createGitStreamPair(
  options: PortGitStreamOptions = {},
): [PortGitStreamResult, PortGitStreamResult] {
  const channel = new MessageChannel();

  // Wrap native ports
  const port1 = wrapNativeMessagePort(channel.port1);
  const port2 = wrapNativeMessagePort(channel.port2);

  return [createGitStreamFromPort(port1, options), createGitStreamFromPort(port2, options)];
}

/**
 * Wrap a native MessagePort as MessagePortLike.
 *
 * This is a simplified version for internal use. For production,
 * use wrapNativePort from @statewalker/vcs-utils.
 */
function wrapNativeMessagePort(port: MessagePort): MessagePortLike {
  let started = false;
  const closeListeners = new Set<() => void>();
  const errorListeners = new Set<(error: Error) => void>();

  const wrapper: MessagePortLike = {
    postMessage(data: ArrayBuffer | Uint8Array) {
      const buffer =
        data instanceof ArrayBuffer
          ? data
          : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      port.postMessage(buffer, [buffer]);
    },

    close() {
      port.close();
      for (const listener of closeListeners) {
        listener();
      }
    },

    start() {
      if (started) return;
      started = true;
      port.start();
    },

    addEventListener(type, listener) {
      if (type === "message") {
        port.addEventListener(type, listener as EventListener);
      } else if (type === "close") {
        closeListeners.add(listener as () => void);
      } else if (type === "error") {
        errorListeners.add(listener as (error: Error) => void);
      }
    },

    removeEventListener(type, listener) {
      if (type === "message") {
        port.removeEventListener(type, listener as EventListener);
      } else if (type === "close") {
        closeListeners.delete(listener as () => void);
      } else if (type === "error") {
        errorListeners.delete(listener as (error: Error) => void);
      }
    },
  };

  return wrapper;
}
