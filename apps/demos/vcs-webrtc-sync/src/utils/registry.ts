/**
 * Creates a cleanup registry for managing disposable resources.
 * Register cleanup functions to be invoked when cleaning up.
 *
 * @returns Tuple of [register, cleanup] functions
 */
export function newRegistry(): [register: (cleanup: () => void) => void, cleanup: () => void] {
  const cleanups: Array<() => void> = [];

  function register(cleanup: () => void): void {
    cleanups.push(cleanup);
  }

  function cleanup(): void {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        try {
          fn();
        } catch (e) {
          console.error("Cleanup error:", e);
        }
      }
    }
  }

  return [register, cleanup];
}
