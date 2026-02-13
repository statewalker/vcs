/**
 * Creates a typed context accessor for dependency injection.
 * Provides get/set functions for storing and retrieving instances by key.
 *
 * @param key Unique key for the context value
 * @param create Optional factory function to create default instance
 * @returns Tuple of [get, set] functions
 */
export function newAdapter<T>(
  key: string,
  create?: () => T,
): [get: (ctx: Map<string, unknown>) => T, set: (ctx: Map<string, unknown>, value: T) => void] {
  function get(ctx: Map<string, unknown>): T {
    let value = ctx.get(key) as T | undefined;
    if (value === undefined && create) {
      value = create();
      ctx.set(key, value);
    }
    if (value === undefined) {
      throw new Error(`Context value not found for key: ${key}`);
    }
    return value;
  }

  function set(ctx: Map<string, unknown>, value: T): void {
    ctx.set(key, value);
  }

  return [get, set];
}
