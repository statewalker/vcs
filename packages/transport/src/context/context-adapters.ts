/**
 * Context adapters for ProcessContext.
 *
 * Provides typed getter/setter functions for accessing context fields.
 * This pattern decouples field definitions from a central type,
 * enabling lazy initialization and better composition.
 *
 * @example Creating and using context
 * ```ts
 * import { setTransport, setRepository, setRefStore, getState, getOutput } from "./context-adapters.js";
 *
 * // Create context
 * const ctx: ProcessContext = {};
 * setTransport(ctx, transport);
 * setRepository(ctx, repository);
 * setRefStore(ctx, refStore);
 *
 * // Access fields (state and output are lazy-initialized)
 * const state = getState(ctx);
 * const output = getOutput(ctx);
 * ```
 */

import type { RepositoryFacade } from "../api/repository-facade.js";
import type { TransportApi } from "../api/transport-api.js";
import { HandlerOutput } from "./handler-output.js";
import { ProcessConfiguration } from "./process-config.js";
import type { RefStore } from "./process-context.js";
import { ProtocolState } from "./protocol-state.js";

/**
 * Context type - a simple record for storing context values.
 * Replaces the structured ProcessContext type.
 */
export type ProcessContext = Record<string, unknown>;

/**
 * Creates typed getter and setter functions for a context field.
 *
 * @param key - The key used to store the value in the context
 * @param create - Optional factory function for lazy initialization
 * @returns A tuple of [getter, setter] functions
 *
 * @example Required field (no lazy init)
 * ```ts
 * export const [getTransport, setTransport] = newAdapter<TransportApi>("transport");
 * ```
 *
 * @example Optional field with lazy init
 * ```ts
 * export const [getState, setState] = newAdapter<ProtocolState>("state", () => new ProtocolState());
 * ```
 */
export function newAdapter<T>(
  key: string,
  create?: () => T,
): [get: (ctx: ProcessContext) => T, set: (ctx: ProcessContext, value: T) => void] {
  function get(ctx: ProcessContext): T {
    let value = ctx[key] as T | undefined;
    if (value === undefined && create) {
      value = create();
      ctx[key] = value;
    }
    if (value === undefined) {
      throw new Error(`Context value not found for key: ${key}`);
    }
    return value;
  }
  function set(ctx: ProcessContext, value: T): void {
    ctx[key] = value;
  }
  return [get, set];
}

// ─────────────────────────────────────────────────────────────
// Core adapters (required - no lazy init)
// ─────────────────────────────────────────────────────────────

/**
 * Transport I/O for Git wire protocol.
 * Must be set before use.
 */
export const [getTransport, setTransport] = newAdapter<TransportApi>("transport");

/**
 * Repository operations facade.
 * Must be set before use.
 */
export const [getRepository, setRepository] = newAdapter<RepositoryFacade>("repository");

/**
 * Ref management.
 * Must be set before use.
 */
export const [getRefStore, setRefStore] = newAdapter<RefStore>("refStore");

// ─────────────────────────────────────────────────────────────
// State adapters (with lazy initialization)
// ─────────────────────────────────────────────────────────────

/**
 * Accumulated protocol state.
 * Lazily initialized to a new ProtocolState on first access.
 */
export const [getState, setState] = newAdapter<ProtocolState>("state", () => new ProtocolState());

/**
 * Handler output values.
 * Lazily initialized to a new HandlerOutput on first access.
 */
export const [getOutput, setOutput] = newAdapter<HandlerOutput>(
  "output",
  () => new HandlerOutput(),
);

/**
 * FSM execution configuration.
 * Lazily initialized to a new ProcessConfiguration on first access.
 */
export const [getConfig, setConfig] = newAdapter<ProcessConfiguration>(
  "config",
  () => new ProcessConfiguration(),
);

// ─────────────────────────────────────────────────────────────
// Extended state adapters (push-specific)
// ─────────────────────────────────────────────────────────────

/**
 * Push ref update for hooks.
 * Simplified interface used in hook callbacks.
 */
export interface PushRef {
  refName: string;
  oldOid: string;
  newOid: string;
  force?: boolean;
}

/**
 * Push options received from client (server-side).
 */
export const [getPushOptions, setPushOptions] = newAdapter<string[]>("pushOptions");

/**
 * Pack stream for import (server-side push).
 */
export const [getPackStream, setPackStream] = newAdapter<AsyncIterable<Uint8Array>>("packStream");

// ─────────────────────────────────────────────────────────────
// Hooks adapters
// ─────────────────────────────────────────────────────────────

/**
 * Pre-receive hook signature.
 * Returns true to allow, false to reject, or error message string.
 */
export type PreReceiveHook = (commands: PushRef[], options: string[]) => Promise<boolean | string>;

/**
 * Post-receive hook signature.
 */
export type PostReceiveHook = (commands: PushRef[], options: string[]) => Promise<void>;

/**
 * Update hook signature (per-ref).
 * Returns true to allow, false to reject, or error message string.
 */
export type UpdateHook = (
  refName: string,
  oldOid: string,
  newOid: string,
) => Promise<boolean | string>;

/**
 * Hooks configuration.
 */
export interface Hooks {
  preReceive?: PreReceiveHook;
  postReceive?: PostReceiveHook;
  update?: UpdateHook;
}

// ─────────────────────────────────────────────────────────────
// Helper for optional field access
// ─────────────────────────────────────────────────────────────

/**
 * Creates a getter that returns undefined instead of throwing
 * when the field is not set.
 *
 * @param key - The key to check
 * @returns The value or undefined
 */
export function getOptional<T>(ctx: ProcessContext, key: string): T | undefined {
  return ctx[key] as T | undefined;
}
