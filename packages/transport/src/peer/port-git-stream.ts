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
  // INPUT: Read from port → GitInputStream
  // Note: readStream uses newAsyncGenerator which is lazy - the message listener
  // is only attached when iteration starts. We need to start iteration eagerly
  // so that ACKs are handled even before anyone reads from the input.
  const inputIterable = readStream(port);
  const inputIterator = inputIterable[Symbol.asyncIterator]();

  // Create a wrapper that buffers incoming data and starts iteration eagerly
  const inputQueue: Uint8Array[] = [];
  let inputDone = false;
  let inputError: Error | undefined;
  let inputWakeUp: (() => void) | undefined;

  // Start consuming the input iterator in the background
  // This ensures the port message listener is active for ACK handling
  (async () => {
    try {
      while (true) {
        const { value, done } = await inputIterator.next();
        if (done) {
          inputDone = true;
          inputWakeUp?.();
          break;
        }
        inputQueue.push(value);
        inputWakeUp?.();
      }
    } catch (err) {
      inputError = err instanceof Error ? err : new Error(String(err));
      inputDone = true;
      inputWakeUp?.();
    }
  })();

  // Create an eager async iterable that reads from the buffer
  const eagerInput: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          while (inputQueue.length === 0 && !inputDone) {
            await new Promise<void>((resolve) => {
              inputWakeUp = resolve;
            });
            inputWakeUp = undefined;
          }
          if (inputError) {
            throw inputError;
          }
          if (inputQueue.length > 0) {
            return { value: inputQueue.shift()!, done: false };
          }
          return { value: undefined as unknown as Uint8Array, done: true };
        },
      };
    },
  };

  const gitInput = createInputStreamFromAsyncIterable(eagerInput);

  // OUTPUT: Create queue-based async generator with synchronous callback access
  type QueueItem =
    | { type: "data"; data: Uint8Array }
    | { type: "end" }
    | { type: "error"; error: Error };
  const queue: QueueItem[] = [];
  let wakeUp: (() => void) | undefined;
  let generatorClosed = false;
  let outputClosed = false;

  // Create the async generator that reads from the queue
  const outputStream = (async function* (): AsyncGenerator<Uint8Array> {
    while (!generatorClosed || queue.length > 0) {
      if (queue.length === 0) {
        if (generatorClosed) break;
        await new Promise<void>((resolve) => {
          wakeUp = resolve;
        });
        wakeUp = undefined;
        continue;
      }

      const item = queue.shift();
      if (!item) continue;
      if (item.type === "error") {
        generatorClosed = true;
        throw item.error;
      }
      if (item.type === "end") {
        generatorClosed = true;
        return;
      }
      yield item.data;
    }
  })();

  // Create the GitOutputStream that writes to the queue (synchronously available)
  const gitOutput = createOutputStreamFromWritable(
    async (buf: Uint8Array) => {
      if (outputClosed) {
        throw new Error("Cannot write after close");
      }
      queue.push({ type: "data", data: buf });
      wakeUp?.();
    },
    async () => {
      if (outputClosed) return;
      outputClosed = true;
      queue.push({ type: "end" });
      wakeUp?.();
    },
  );

  const writeCompletion = writeStream(port, outputStream, options);

  const closePort = () => {
    generatorClosed = true;
    wakeUp?.();
    gitInput.close();
    gitOutput.close();
    port.close();
  };

  const stream: GitBidirectionalStream = {
    input: gitInput,
    output: gitOutput,
    close: async () => {
      await Promise.all([gitInput.close(), gitOutput.close()]);
      await writeCompletion;
      port.close();
    },
  };

  return {
    stream,
    writeCompletion,
    closePort,
  };
}

/**
 * Create a pair of connected GitBidirectionalStreams for testing.
 *
 * Creates a MessageChannel internally and returns two connected streams
 * that can communicate with each other.
 *
 * @param options - Configuration options
 * @returns Tuple of two connected PortGitStreamResult instances
 *
 * @example
 * ```typescript
 * const [resultA, resultB] = createGitStreamPair();
 *
 * // Run client and server concurrently
 * await Promise.all([
 *   clientOperation(resultA.stream),
 *   serverOperation(resultB.stream),
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
