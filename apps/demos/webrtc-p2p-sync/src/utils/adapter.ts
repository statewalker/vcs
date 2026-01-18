/**
 * Context adapter pattern for dependency injection.
 * Creates typed accessors for retrieving and setting values in a context object.
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
