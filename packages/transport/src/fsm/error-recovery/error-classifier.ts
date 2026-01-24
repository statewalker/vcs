/**
 * Error classification utility.
 *
 * Classifies runtime errors into categories for the error recovery FSM.
 */

import { getConfig, getOutput, type ProcessContext } from "../../context/context-adapters.js";
import type { ErrorCategory } from "../../context/handler-output.js";

/**
 * Error event types returned by classifyError.
 */
export type ErrorEvent =
  | "PROTOCOL_ERROR"
  | "TRANSPORT_ERROR"
  | "TIMEOUT"
  | "PACK_ERROR"
  | "VALIDATION_ERROR";

/**
 * Classifies an error and populates ctx.output.errorInfo.
 *
 * Call this in error handlers instead of just setting ctx.output.error.
 * Returns the appropriate error event for FSM transition.
 *
 * @example
 * ```ts
 * catch (e) {
 *   return classifyError(ctx, e);
 * }
 * ```
 *
 * @param ctx - Process context to update
 * @param error - The error to classify
 * @returns Error event for FSM transition
 */
export function classifyError(ctx: ProcessContext, error: unknown): ErrorEvent {
  const message = error instanceof Error ? error.message : String(error);
  const output = getOutput(ctx);
  const config = getConfig(ctx);

  // Use shared classification logic
  const info = createErrorInfo(message, config.allowReconnect ?? false);

  // Update context with error information
  output.error = message;
  output.errorInfo = {
    category: info.category,
    message,
    recoverable: info.recoverable,
    retryable: info.retryable,
  };

  return info.event;
}

/**
 * Creates an error info object without modifying context.
 *
 * Useful for testing or when you need to check error category
 * before deciding how to handle it.
 *
 * @param message - Error message to classify
 * @param allowReconnect - Whether reconnection is allowed
 * @returns Error info object
 */
export function createErrorInfo(
  message: string,
  allowReconnect = false,
): { category: ErrorCategory; event: ErrorEvent; recoverable: boolean; retryable: boolean } {
  // Timeout errors
  if (
    message.includes("timeout") ||
    message.includes("Timeout") ||
    message.includes("timed out") ||
    message.includes("ETIMEDOUT")
  ) {
    return {
      category: "TIMEOUT",
      event: "TIMEOUT",
      recoverable: true,
      retryable: true,
    };
  }

  // Transport/connection errors
  if (
    message.includes("connection") ||
    message.includes("Connection") ||
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("EPIPE") ||
    message.includes("socket") ||
    message.includes("network") ||
    message.includes("Network")
  ) {
    return {
      category: "TRANSPORT_ERROR",
      event: "TRANSPORT_ERROR",
      recoverable: true,
      retryable: allowReconnect,
    };
  }

  // Pack errors
  if (
    message.includes("pack") ||
    message.includes("Pack") ||
    message.includes("corrupt") ||
    message.includes("checksum") ||
    message.includes("invalid object")
  ) {
    return {
      category: "PACK_ERROR",
      event: "PACK_ERROR",
      recoverable: false,
      retryable: false,
    };
  }

  // Validation errors
  if (
    message.includes("invalid") ||
    message.includes("Invalid") ||
    message.includes("not found") ||
    message.includes("unknown ref") ||
    message.includes("rejected")
  ) {
    return {
      category: "VALIDATION_ERROR",
      event: "VALIDATION_ERROR",
      recoverable: false,
      retryable: false,
    };
  }

  // Default: protocol error
  return {
    category: "PROTOCOL_ERROR",
    event: "PROTOCOL_ERROR",
    recoverable: false,
    retryable: false,
  };
}
