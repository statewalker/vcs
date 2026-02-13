/**
 * Context Adapter Pattern
 *
 * This module provides a pattern for type-safe dependency injection using
 * a simple context object. It creates paired get/set functions that encapsulate
 * key strings and provide compile-time type safety.
 *
 * ## Pattern Overview
 *
 * The context adapter pattern:
 * - **Encapsulates keys** - No magic strings scattered across codebase
 * - **Type-safe access** - Get/set enforce the correct value type
 * - **Lazy initialization** - Optional factory creates values on first access
 * - **Flexible contexts** - Same adapters work with any context object
 *
 * ## Comparison to Other DI Patterns
 *
 * | Feature              | Context Adapters | Service Locator | Constructor DI |
 * |----------------------|------------------|-----------------|----------------|
 * | Type safety          | ✓ Full           | ✗ Runtime       | ✓ Full         |
 * | Boilerplate          | Minimal          | Medium          | High           |
 * | Lazy creation        | ✓ Built-in       | ✓               | ✗              |
 * | Testing              | ✓ Easy swap      | ✓               | ✓              |
 * | Flexibility          | ✓ Multiple ctx   | ✓               | ✗ Fixed deps   |
 *
 * ## Usage
 *
 * ### 1. Define Adapters
 *
 * ```typescript
 * // adapters/session-adapter.ts
 * import { newAdapter } from "../utils/adapter.js";
 * import { SessionModel } from "../models/session-model.js";
 *
 * // Adapter with lazy initialization
 * export const [getSessionModel, setSessionModel] =
 *   newAdapter<SessionModel>("session-model", () => new SessionModel());
 *
 * // Adapter without factory (must be set explicitly)
 * export const [getPeerInstance, setPeerInstance] =
 *   newAdapter<PeerInstance | null>("peer-instance");
 * ```
 *
 * ### 2. Use in Application
 *
 * ```typescript
 * // Create context
 * const ctx: AppContext = {};
 *
 * // Get with lazy initialization
 * const session = getSessionModel(ctx); // Creates if not exists
 *
 * // Explicit set
 * setPeerInstance(ctx, peer);
 *
 * // Get after set
 * const peer = getPeerInstance(ctx);
 * ```
 *
 * ### 3. Testing with Mocks
 *
 * ```typescript
 * // In tests - inject mocks into context
 * const ctx: AppContext = {};
 * setSessionModel(ctx, mockSession);
 * setPeerInstance(ctx, mockPeer);
 *
 * // Now controller under test uses mocks
 * const cleanup = createController(ctx);
 * ```
 *
 * ## Key Benefits
 *
 * - **Zero framework overhead** - Just functions and objects
 * - **IDE support** - Full autocomplete for adapters and types
 * - **Testable** - Easy to inject mocks via context
 * - **Scalable** - Add new adapters without changing existing code
 *
 * @param key The unique key for this adapter in the context
 * @param create Optional factory function for lazy initialization
 * @returns Tuple of [get, set] functions for accessing the value
 */
export function newAdapter<T>(
  key: string,
  create?: () => T,
): [
  get: (ctx: Record<string, unknown>) => T,
  set: (ctx: Record<string, unknown>, value: T) => void,
] {
  function get(ctx: Record<string, unknown>): T {
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

  function set(ctx: Record<string, unknown>, value: T): void {
    ctx[key] = value;
  }

  return [get, set];
}
