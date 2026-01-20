/**
 * P2P Error Recovery: Disconnect handling, timeouts, and partial transfer recovery.
 *
 * This module provides error handling utilities for P2P transport operations:
 * - Custom error types for P2P-specific failures
 * - Timeout wrappers for async operations
 * - Disconnect detection and handling
 * - Partial transfer state tracking for potential recovery
 */

import type { MessagePortLike } from "@statewalker/vcs-utils";
import { TransportError } from "../protocol/errors.js";

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error when the port/peer disconnects unexpectedly.
 */
export class PortDisconnectedError extends TransportError {
  /** Time when disconnect was detected */
  readonly disconnectedAt: Date;

  constructor(message = "Port disconnected") {
    super(message);
    this.name = "PortDisconnectedError";
    this.disconnectedAt = new Date();
  }
}

/**
 * Error when an operation times out.
 */
export class PortTimeoutError extends TransportError {
  /** Operation that timed out */
  readonly operation: string;
  /** Timeout duration in milliseconds */
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`Operation '${operation}' timed out after ${timeoutMs}ms`);
    this.name = "PortTimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Error when a transfer is aborted mid-stream.
 */
export class TransferAbortedError extends TransportError {
  /** Bytes successfully transferred before abort */
  readonly bytesTransferred: number;
  /** Total bytes expected (if known) */
  readonly bytesExpected?: number;
  /** Underlying cause of the abort */
  readonly cause?: Error;

  constructor(bytesTransferred: number, bytesExpected?: number, cause?: Error) {
    const progressInfo = bytesExpected
      ? ` (${bytesTransferred}/${bytesExpected} bytes)`
      : ` (${bytesTransferred} bytes transferred)`;
    const causeInfo = cause ? `: ${cause.message}` : "";
    super(`Transfer aborted${progressInfo}${causeInfo}`);
    this.name = "TransferAbortedError";
    this.bytesTransferred = bytesTransferred;
    this.bytesExpected = bytesExpected;
    this.cause = cause;
  }
}

// =============================================================================
// Timeout Utilities
// =============================================================================

/**
 * Default timeout values.
 */
export const DEFAULT_TIMEOUTS = {
  /** Connection establishment timeout */
  connect: 30_000,
  /** Single operation timeout */
  operation: 60_000,
  /** Entire transfer timeout */
  transfer: 300_000,
  /** Idle timeout (no data received) */
  idle: 30_000,
} as const;

/**
 * Options for timeout wrapper.
 */
export interface TimeoutOptions {
  /** Timeout duration in milliseconds */
  timeoutMs: number;
  /** Operation name for error messages */
  operation?: string;
  /** Abort signal to cancel the operation */
  signal?: AbortSignal;
}

/**
 * Wrap a promise with a timeout.
 *
 * @param promise - Promise to wrap
 * @param options - Timeout options
 * @returns Promise that rejects with PortTimeoutError on timeout
 *
 * @example
 * ```typescript
 * const result = await withTimeout(
 *   fetchFromPeer(port),
 *   { timeoutMs: 30000, operation: 'fetch' }
 * );
 * ```
 */
export async function withTimeout<T>(promise: Promise<T>, options: TimeoutOptions): Promise<T> {
  const { timeoutMs, operation = "operation", signal } = options;

  // Check if already aborted
  if (signal?.aborted) {
    throw new PortTimeoutError(operation, 0);
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new PortTimeoutError(operation, timeoutMs));
      }
    }, timeoutMs);

    // Set up abort signal listener
    const abortHandler = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        reject(new PortTimeoutError(operation, 0));
      }
    };

    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    // Wait for promise
    promise
      .then((value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          if (signal) {
            signal.removeEventListener("abort", abortHandler);
          }
          resolve(value);
        }
      })
      .catch((error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          if (signal) {
            signal.removeEventListener("abort", abortHandler);
          }
          reject(error);
        }
      });
  });
}

/**
 * Create a timeout that resets on activity.
 *
 * Useful for idle timeouts where the timer should reset
 * each time data is received.
 *
 * @param timeoutMs - Idle timeout duration in milliseconds
 * @param onTimeout - Callback when timeout fires
 * @returns Object with reset, cancel, and dispose methods
 *
 * @example
 * ```typescript
 * const idleTimeout = createIdleTimeout(30000, () => {
 *   console.log('Connection idle, closing');
 *   port.close();
 * });
 *
 * for await (const chunk of stream.input) {
 *   idleTimeout.reset();
 *   processChunk(chunk);
 * }
 *
 * idleTimeout.cancel();
 * ```
 */
export function createIdleTimeout(
  timeoutMs: number,
  onTimeout: () => void,
): {
  /** Reset the timeout timer */
  reset: () => void;
  /** Cancel the timeout (no callback) */
  cancel: () => void;
  /** Check if timeout has fired */
  hasFired: () => boolean;
} {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let fired = false;

  const scheduleTimeout = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fired = true;
      timeoutId = null;
      onTimeout();
    }, timeoutMs);
  };

  // Start initial timeout
  scheduleTimeout();

  return {
    reset: () => {
      if (!fired) {
        scheduleTimeout();
      }
    },
    cancel: () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
    hasFired: () => fired,
  };
}

// =============================================================================
// Disconnect Handling
// =============================================================================

/**
 * Connection state for tracking.
 */
export type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

/**
 * Options for disconnect monitor.
 */
export interface DisconnectMonitorOptions {
  /** Callback when disconnect is detected */
  onDisconnect?: (error?: Error) => void;
  /** Callback when error occurs */
  onError?: (error: Error) => void;
  /** Heartbeat interval for keep-alive (0 to disable) */
  heartbeatMs?: number;
}

/**
 * Monitor for port disconnect events.
 *
 * Provides callbacks for disconnect and error events, and tracks
 * connection state.
 */
export interface DisconnectMonitor {
  /** Current connection state */
  readonly state: ConnectionState;
  /** Error that caused disconnect (if any) */
  readonly error: Error | undefined;
  /** Mark connection as established */
  markConnected: () => void;
  /** Check if currently connected */
  isConnected: () => boolean;
  /** Dispose of the monitor */
  dispose: () => void;
}

/**
 * Create a disconnect monitor for a MessagePortLike.
 *
 * Monitors the port for close and error events, and provides
 * callbacks and state tracking.
 *
 * @param port - MessagePortLike to monitor
 * @param options - Monitor options
 * @returns DisconnectMonitor interface
 *
 * @example
 * ```typescript
 * const monitor = createDisconnectMonitor(port, {
 *   onDisconnect: () => console.log('Peer disconnected'),
 *   onError: (err) => console.error('Port error:', err),
 * });
 *
 * try {
 *   await fetchFromPeer(port);
 * } finally {
 *   monitor.dispose();
 * }
 * ```
 */
export function createDisconnectMonitor(
  port: MessagePortLike,
  options: DisconnectMonitorOptions = {},
): DisconnectMonitor {
  const { onDisconnect, onError } = options;

  let state: ConnectionState = "connecting";
  let error: Error | undefined;

  const handleClose = () => {
    if (state === "disconnected" || state === "error") return;
    state = "disconnected";
    if (onDisconnect) {
      onDisconnect(error);
    }
  };

  const handleError = (err: Error) => {
    if (state === "error") return;
    error = err;
    state = "error";
    if (onError) {
      onError(err);
    }
    if (onDisconnect) {
      onDisconnect(err);
    }
  };

  port.addEventListener("close", handleClose);
  port.addEventListener("error", handleError);

  return {
    get state() {
      return state;
    },
    get error() {
      return error;
    },
    markConnected: () => {
      if (state === "connecting") {
        state = "connected";
      }
    },
    isConnected: () => state === "connected",
    dispose: () => {
      port.removeEventListener("close", handleClose);
      port.removeEventListener("error", handleError);
    },
  };
}

// =============================================================================
// Partial Transfer Tracking
// =============================================================================

/**
 * State of a partial transfer for potential recovery.
 */
export interface PartialTransferState {
  /** Unique transfer ID */
  transferId: string;
  /** Direction of transfer */
  direction: "fetch" | "push";
  /** Refs involved in the transfer */
  refs: Map<string, string>;
  /** Bytes transferred so far */
  bytesTransferred: number;
  /** Total bytes expected (if known) */
  bytesExpected?: number;
  /** Object IDs already received/sent */
  completedObjects: Set<string>;
  /** When transfer started */
  startedAt: Date;
  /** When last progress was made */
  lastProgressAt: Date;
  /** Error that interrupted transfer (if any) */
  error?: Error;
}

/**
 * Tracker for partial transfer state.
 *
 * Maintains state during a transfer operation that can be used
 * for recovery or progress reporting.
 */
export interface TransferTracker {
  /** Current transfer state */
  readonly state: PartialTransferState;
  /** Update bytes transferred */
  addBytes: (count: number) => void;
  /** Set total expected bytes */
  setExpectedBytes: (total: number) => void;
  /** Mark an object as completed */
  markObjectComplete: (objectId: string) => void;
  /** Record an error */
  recordError: (error: Error) => void;
  /** Get progress percentage (0-100) */
  getProgress: () => number;
  /** Check if transfer can potentially be resumed */
  canResume: () => boolean;
}

/**
 * Create a tracker for a transfer operation.
 *
 * @param direction - 'fetch' or 'push'
 * @param refs - Map of ref names to object IDs
 * @returns TransferTracker interface
 *
 * @example
 * ```typescript
 * const tracker = createTransferTracker('fetch', refsMap);
 *
 * for await (const chunk of packData) {
 *   tracker.addBytes(chunk.length);
 *   // Process chunk...
 * }
 *
 * if (tracker.state.error) {
 *   console.log(`Transfer failed at ${tracker.getProgress()}%`);
 * }
 * ```
 */
export function createTransferTracker(
  direction: "fetch" | "push",
  refs: Map<string, string>,
): TransferTracker {
  const state: PartialTransferState = {
    transferId: generateTransferId(),
    direction,
    refs: new Map(refs),
    bytesTransferred: 0,
    completedObjects: new Set(),
    startedAt: new Date(),
    lastProgressAt: new Date(),
  };

  return {
    get state() {
      return state;
    },
    addBytes: (count: number) => {
      state.bytesTransferred += count;
      state.lastProgressAt = new Date();
    },
    setExpectedBytes: (total: number) => {
      state.bytesExpected = total;
    },
    markObjectComplete: (objectId: string) => {
      state.completedObjects.add(objectId);
      state.lastProgressAt = new Date();
    },
    recordError: (error: Error) => {
      state.error = error;
    },
    getProgress: () => {
      if (!state.bytesExpected || state.bytesExpected === 0) {
        return 0;
      }
      return Math.min(100, Math.round((state.bytesTransferred / state.bytesExpected) * 100));
    },
    canResume: () => {
      // Can resume if we have partial data and know what refs we need
      return state.bytesTransferred > 0 && state.refs.size > 0 && !state.error;
    },
  };
}

/**
 * Generate a unique transfer ID.
 */
function generateTransferId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `xfer-${timestamp}-${random}`;
}

// =============================================================================
// Retry Utilities
// =============================================================================

/**
 * Options for retry wrapper.
 */
export interface RetryOptions {
  /** Maximum number of retries (default: 3) */
  maxRetries?: number;
  /** Initial delay between retries in ms (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay between retries in ms (default: 30000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Function to determine if error is retryable */
  isRetryable?: (error: Error) => boolean;
  /** Callback before each retry */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
  /** Abort signal to cancel retries */
  signal?: AbortSignal;
}

/**
 * Default retryable error checker.
 *
 * Retries on timeout and disconnect, but not on protocol errors.
 */
export function isRetryableError(error: Error): boolean {
  // Retry on timeout
  if (error instanceof PortTimeoutError) {
    return true;
  }

  // Retry on disconnect
  if (error instanceof PortDisconnectedError) {
    return true;
  }

  // Don't retry on protocol errors or transfer aborts
  if (error instanceof TransferAbortedError) {
    return false;
  }

  // Check error message for common retryable conditions
  const message = error.message.toLowerCase();
  if (message.includes("timeout") || message.includes("disconnect")) {
    return true;
  }

  return false;
}

/**
 * Execute an async function with retry logic.
 *
 * @param fn - Async function to execute
 * @param options - Retry options
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchFromPeer(port, options),
 *   {
 *     maxRetries: 3,
 *     onRetry: (attempt, err, delay) => {
 *       console.log(`Retry ${attempt} after ${delay}ms: ${err.message}`);
 *     },
 *   }
 * );
 * ```
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    isRetryable = isRetryableError,
    onRetry,
    signal,
  } = options;

  let lastError: Error | undefined;
  let delayMs = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check abort signal
    if (signal?.aborted) {
      throw new PortTimeoutError("retry", 0);
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If we've exhausted retries or error is not retryable, throw
      if (attempt >= maxRetries || !isRetryable(lastError)) {
        throw lastError;
      }

      // Notify about retry
      if (onRetry) {
        onRetry(attempt + 1, lastError, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs, signal);

      // Increase delay with exponential backoff
      delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
    }
  }

  // This shouldn't be reached, but TypeScript needs it
  throw lastError ?? new Error("Retry failed");
}

/**
 * Sleep for a duration with abort support.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PortTimeoutError("sleep", 0));
      return;
    }

    const timeoutId = setTimeout(resolve, ms);

    if (signal) {
      const abortHandler = () => {
        clearTimeout(timeoutId);
        reject(new PortTimeoutError("sleep", 0));
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  });
}

// =============================================================================
// Combined Utilities
// =============================================================================

/**
 * Options for wrapped P2P operations.
 */
export interface P2POperationOptions {
  /** Operation timeout in ms */
  timeoutMs?: number;
  /** Enable disconnect monitoring */
  monitorDisconnect?: boolean;
  /** Enable transfer tracking */
  trackTransfer?: boolean;
  /** Retry options (undefined to disable retries) */
  retry?: RetryOptions;
  /** Progress callback for transfer tracking */
  onProgress?: (bytesTransferred: number, bytesExpected?: number) => void;
}

/**
 * Context provided to wrapped operations.
 */
export interface P2POperationContext {
  /** Abort signal for cancellation */
  signal: AbortSignal;
  /** Disconnect monitor (if enabled) */
  monitor?: DisconnectMonitor;
  /** Transfer tracker (if enabled) */
  tracker?: TransferTracker;
  /** Report progress */
  reportProgress: (bytes: number) => void;
  /** Check if operation should continue */
  shouldContinue: () => boolean;
}

/**
 * Wrap a P2P operation with error recovery features.
 *
 * Combines timeout, disconnect monitoring, transfer tracking,
 * and optional retry logic.
 *
 * @param port - MessagePortLike for the operation
 * @param operation - Name of the operation for error messages
 * @param fn - Async function to execute
 * @param options - Operation options
 * @returns Result of the operation
 *
 * @example
 * ```typescript
 * const result = await wrapP2POperation(
 *   port,
 *   'fetch',
 *   async (ctx) => {
 *     ctx.monitor?.markConnected();
 *     const data = await fetchFromPeer(port);
 *     ctx.reportProgress(data.bytesReceived);
 *     return data;
 *   },
 *   {
 *     timeoutMs: 60000,
 *     monitorDisconnect: true,
 *     retry: { maxRetries: 2 },
 *   }
 * );
 * ```
 */
export async function wrapP2POperation<T>(
  port: MessagePortLike,
  operation: string,
  fn: (context: P2POperationContext) => Promise<T>,
  options: P2POperationOptions = {},
): Promise<T> {
  const {
    timeoutMs = DEFAULT_TIMEOUTS.operation,
    monitorDisconnect = true,
    trackTransfer = false,
    retry,
    onProgress,
  } = options;

  // Create abort controller
  const abortController = new AbortController();

  // Create disconnect monitor
  let monitor: DisconnectMonitor | undefined;
  if (monitorDisconnect) {
    monitor = createDisconnectMonitor(port, {
      onDisconnect: () => {
        abortController.abort();
      },
    });
  }

  // Create transfer tracker
  let tracker: TransferTracker | undefined;
  if (trackTransfer) {
    tracker = createTransferTracker(operation === "push" ? "push" : "fetch", new Map());
  }

  // Create context
  const context: P2POperationContext = {
    signal: abortController.signal,
    monitor,
    tracker,
    reportProgress: (bytes: number) => {
      if (tracker) {
        tracker.addBytes(bytes);
      }
      if (onProgress) {
        onProgress(tracker?.state.bytesTransferred ?? bytes, tracker?.state.bytesExpected);
      }
    },
    shouldContinue: () => {
      return !abortController.signal.aborted;
    },
  };

  // Create the operation function
  const executeOperation = async () => {
    return withTimeout(fn(context), {
      timeoutMs,
      operation,
      signal: abortController.signal,
    });
  };

  try {
    // Execute with or without retry
    if (retry) {
      return await withRetry(executeOperation, {
        ...retry,
        signal: abortController.signal,
      });
    } else {
      return await executeOperation();
    }
  } catch (error) {
    // Record error in tracker
    if (tracker && error instanceof Error) {
      tracker.recordError(error);
    }

    // Convert to appropriate error type
    if (error instanceof PortTimeoutError || error instanceof PortDisconnectedError) {
      throw error;
    }

    // Check if this was a disconnect
    if (monitor?.state === "disconnected" || monitor?.state === "error") {
      throw new PortDisconnectedError(
        monitor.error?.message ?? "Port disconnected during operation",
      );
    }

    throw error;
  } finally {
    // Clean up
    monitor?.dispose();
  }
}
