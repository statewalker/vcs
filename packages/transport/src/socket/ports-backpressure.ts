/**
 * Credit-based backpressure control for MessagePort communication.
 *
 * This module implements a credit-based flow control mechanism that prevents
 * fast producers from overwhelming slow consumers. The pattern works as follows:
 *
 * 1. The receiver grants initial "credits" to the sender (window size)
 * 2. Each message sent consumes one credit
 * 3. When credits are exhausted, the sender buffers locally or waits
 * 4. As the receiver processes messages, it periodically replenishes credits
 *
 * This approach provides:
 * - **Bounded memory usage**: The sender's buffer is limited by highWaterMark
 * - **Natural backpressure**: Fast producers automatically slow down
 * - **Batched acknowledgments**: Credits are replenished in batches for efficiency
 *
 * @example
 * ```typescript
 * // Sender side
 * const writer = createPortWriter(port, { highWaterMark: 64 });
 * await writer.write({ data: "hello" });
 * await writer.drain(); // Wait for all pending messages to be sent
 *
 * // Receiver side
 * createPortReceiver(port, {
 *   windowSize: 64,
 *   replenishBatch: 16,
 *   onData: async (payload) => {
 *     console.log("Received:", payload);
 *   }
 * });
 * ```
 */

/**
 * Message types used in the credit-based protocol.
 */
export type BackpressureMessageType = "CREDIT" | "DATA";

/**
 * Credit message sent from receiver to sender to grant send permission.
 */
export interface CreditMessage {
  type: "CREDIT";
  /** Number of credits (message slots) being granted. */
  n: number;
}

/**
 * Data message sent from sender to receiver.
 */
export interface DataMessage<T = unknown> {
  type: "DATA";
  /** Monotonically increasing message ID for ordering/debugging. */
  id: number;
  /** The payload being transmitted. */
  payload: T;
}

/**
 * Union type for all messages in the backpressure protocol.
 */
export type BackpressureMessage<T = unknown> = CreditMessage | DataMessage<T>;

/**
 * Options for configuring the port writer.
 */
export interface PortWriterOptions {
  /**
   * Maximum number of messages to buffer locally before applying backpressure.
   *
   * When the pending queue exceeds this threshold, `write()` will wait for
   * credits before returning. This prevents unbounded memory growth when
   * the producer is faster than the consumer.
   *
   * @default 64
   */
  highWaterMark?: number;
}

/**
 * Options for configuring the port receiver.
 */
export interface PortReceiverOptions<T = unknown> {
  /**
   * Initial number of credits to grant to the sender.
   *
   * This determines how many messages the sender can transmit before
   * needing to wait for credit replenishment. Larger values reduce
   * round-trip latency but increase potential memory usage.
   *
   * @default 64
   */
  windowSize?: number;

  /**
   * Number of messages to process before replenishing credits.
   *
   * Credits are sent back to the sender in batches to reduce overhead.
   * Smaller values provide smoother flow but more message overhead.
   * Should be less than or equal to windowSize.
   *
   * @default 16
   */
  replenishBatch?: number;

  /**
   * Callback invoked for each received data payload.
   *
   * This function can be async - the receiver will wait for it to complete
   * before counting the message as processed. This ensures backpressure
   * is correctly propagated through async processing pipelines.
   *
   * @param payload - The data payload from the sender.
   */
  onData: (payload: T) => void | Promise<void>;
}

/**
 * Interface returned by createPortWriter for sending data with backpressure.
 */
export interface PortWriter<T = unknown> {
  /**
   * Send a payload to the receiver.
   *
   * If credits are available and no messages are pending, the payload is
   * sent immediately. Otherwise, it is queued locally.
   *
   * When the local queue exceeds highWaterMark, this method will wait
   * (apply backpressure) until credits arrive from the receiver.
   *
   * @param payload - The data to send.
   * @returns A promise that resolves when the payload is queued or sent.
   *          Note: Resolution does NOT mean the receiver has processed it.
   */
  write: (payload: T) => Promise<void>;

  /**
   * Wait for all pending messages to be sent.
   *
   * This method blocks until:
   * - The pending queue is empty, AND
   * - There are credits available (meaning the channel is not blocked)
   *
   * Use this before closing the port to ensure all data has been transmitted.
   *
   * @returns A promise that resolves when all pending data has been sent.
   */
  drain: () => Promise<void>;

  /**
   * Stop listening for credit messages and clean up resources.
   *
   * After calling close(), the writer should not be used for further writes.
   * Any pending messages in the queue will NOT be sent.
   */
  close: () => void;
}

/**
 * Interface returned by createPortReceiver for controlling the receiver.
 */
export interface PortReceiver {
  /**
   * Stop listening for data messages and clean up resources.
   *
   * After calling close(), the receiver will no longer process incoming
   * messages or replenish credits to the sender.
   */
  close: () => void;
}

/**
 * Minimal port interface required for backpressure communication.
 *
 * This interface is compatible with MessagePort, Worker, and similar APIs.
 */
export interface BackpressurePort {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  start?(): void;
}

/**
 * Creates a writer that sends data over a port with credit-based backpressure.
 *
 * The writer maintains an internal queue of pending messages and only transmits
 * when it has credits from the receiver. This prevents overwhelming slow consumers
 * and provides bounded memory usage on the sender side.
 *
 * ## Protocol
 *
 * The writer listens for CREDIT messages from the receiver:
 * ```json
 * { "type": "CREDIT", "n": 16 }
 * ```
 *
 * And sends DATA messages when credits are available:
 * ```json
 * { "type": "DATA", "id": 1, "payload": <your-data> }
 * ```
 *
 * ## Backpressure Behavior
 *
 * 1. Messages are sent immediately if credits > 0 and queue is empty
 * 2. Otherwise, messages are queued locally
 * 3. When queue exceeds highWaterMark, write() blocks until credits arrive
 * 4. The flush() function drains the queue as credits become available
 *
 * @param port - The port to send messages through.
 * @param options - Configuration options.
 * @returns A PortWriter instance for sending data.
 *
 * @example
 * ```typescript
 * const { port1, port2 } = new MessageChannel();
 * port1.start();
 * port2.start();
 *
 * const writer = createPortWriter<string>(port1, { highWaterMark: 32 });
 *
 * // Send multiple messages - backpressure is handled automatically
 * for (let i = 0; i < 1000; i++) {
 *   await writer.write(`message ${i}`);
 * }
 *
 * // Ensure all messages are sent before closing
 * await writer.drain();
 * writer.close();
 * ```
 */
export function createPortWriter<T = unknown>(
  port: BackpressurePort,
  options: PortWriterOptions = {},
): PortWriter<T> {
  const { highWaterMark = 64 } = options;

  /** Current number of credits available for sending. */
  let credits = 0;

  /** Monotonically increasing ID for outgoing messages. */
  let nextId = 1;

  /** Queue of payloads waiting for credits to be sent. */
  const pending: T[] = [];

  /** Promises waiting for credits to become available. */
  let creditWaiters: Array<() => void> = [];

  /** Whether the writer has been closed. */
  let closed = false;

  /**
   * Handle incoming credit messages from the receiver.
   */
  const onMessage = (e: MessageEvent): void => {
    const msg = e.data as BackpressureMessage<T> | undefined;
    if (msg?.type === "CREDIT") {
      credits += msg.n;
      flush();

      // Resolve anyone waiting for credits
      if (credits > 0) {
        const waiters = creditWaiters;
        creditWaiters = [];
        for (const resolve of waiters) {
          resolve();
        }
      }
    }
  };

  port.addEventListener("message", onMessage);
  port.start?.();

  /**
   * Drain pending messages while credits are available.
   */
  function flush(): void {
    while (credits > 0 && pending.length > 0) {
      const payload = pending.shift();
      if (payload === undefined) break;
      credits--;
      port.postMessage({ type: "DATA", id: nextId++, payload } satisfies DataMessage<T>);
    }
  }

  /**
   * Wait until at least one credit is available.
   */
  function waitForCredit(): Promise<void> {
    if (credits > 0) return Promise.resolve();
    return new Promise<void>((resolve) => creditWaiters.push(resolve));
  }

  return {
    async write(payload: T): Promise<void> {
      if (closed) {
        throw new Error("Cannot write: writer is closed");
      }

      // If we have credits and no pending messages, send immediately
      if (credits > 0 && pending.length === 0) {
        credits--;
        port.postMessage({ type: "DATA", id: nextId++, payload } satisfies DataMessage<T>);
        return;
      }

      // Otherwise buffer locally (bounded by highWaterMark)
      pending.push(payload);

      if (pending.length > highWaterMark) {
        // Apply backpressure to the producer by waiting until credits arrive
        await waitForCredit();
      }

      flush();
    },

    async drain(): Promise<void> {
      while (pending.length > 0) {
        await waitForCredit();
        flush();
      }
    },

    close(): void {
      if (closed) return;
      closed = true;
      port.removeEventListener("message", onMessage);
    },
  };
}

/**
 * Creates a receiver that processes data from a port with credit-based backpressure.
 *
 * The receiver grants initial credits to the sender and replenishes them in
 * batches as messages are processed. This allows the sender to know when it's
 * safe to send more data without overwhelming the receiver.
 *
 * ## Protocol
 *
 * The receiver sends CREDIT messages to grant send permission:
 * ```json
 * { "type": "CREDIT", "n": 64 }  // Initial window
 * { "type": "CREDIT", "n": 16 }  // Replenishment batch
 * ```
 *
 * And listens for DATA messages from the sender:
 * ```json
 * { "type": "DATA", "id": 1, "payload": <data> }
 * ```
 *
 * ## Credit Replenishment
 *
 * Credits are replenished in batches (replenishBatch) rather than individually
 * to reduce message overhead. The receiver tracks how many messages have been
 * processed since the last credit grant and sends a batch when the threshold
 * is reached.
 *
 * ## Async Processing
 *
 * The onData callback can be async. The receiver awaits its completion before
 * counting the message as processed. This ensures proper backpressure when
 * the receiver has async processing (e.g., writing to disk, database calls).
 *
 * @param port - The port to receive messages from.
 * @param options - Configuration options including the data handler.
 * @returns A PortReceiver instance for controlling the receiver.
 *
 * @example
 * ```typescript
 * const receiver = createPortReceiver<string>(port, {
 *   windowSize: 64,
 *   replenishBatch: 16,
 *   onData: async (message) => {
 *     // Process message - backpressure is automatic
 *     await saveToDatabase(message);
 *     console.log("Processed:", message);
 *   }
 * });
 *
 * // Later, when done receiving
 * receiver.close();
 * ```
 */
export function createPortReceiver<T = unknown>(
  port: BackpressurePort,
  options: PortReceiverOptions<T>,
): PortReceiver {
  const { windowSize = 64, replenishBatch = 16, onData } = options;

  /** Number of messages processed since last credit replenishment. */
  let processedSinceCredit = 0;

  /** Whether the receiver has been closed. */
  let closed = false;

  /**
   * Handle incoming data messages from the sender.
   */
  const onMessage = async (e: MessageEvent): Promise<void> => {
    if (closed) return;

    const msg = e.data as BackpressureMessage<T> | undefined;
    if (msg?.type !== "DATA") return;

    // Process data (can be async)
    await onData(msg.payload);

    processedSinceCredit++;

    // Replenish credits in batches
    if (processedSinceCredit >= replenishBatch) {
      port.postMessage({ type: "CREDIT", n: processedSinceCredit } satisfies CreditMessage);
      processedSinceCredit = 0;
    }
  };

  port.addEventListener("message", onMessage);
  port.start?.();

  // Grant initial credits to the sender
  port.postMessage({ type: "CREDIT", n: windowSize } satisfies CreditMessage);

  return {
    close(): void {
      if (closed) return;
      closed = true;
      port.removeEventListener("message", onMessage);

      // Send any remaining credits to unblock the sender
      if (processedSinceCredit > 0) {
        port.postMessage({ type: "CREDIT", n: processedSinceCredit } satisfies CreditMessage);
      }
    },
  };
}
