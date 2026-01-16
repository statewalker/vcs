/**
 * Event subscription cleanup helper.
 * Manages a set of cleanup functions for unsubscribing from events.
 *
 * @returns Tuple of [register, cleanup] functions
 *   - register: Add a cleanup function to the registry
 *   - cleanup: Execute all registered cleanup functions
 */
export function newRegistry(): [
  register: (cleanup?: () => void) => () => void,
  cleanup: () => void,
] {
  const cleanups = new Set<() => void>();

  return [
    (cleanup?: () => void) => {
      if (!cleanup) return () => {};
      cleanups.add(cleanup);
      return () => {
        cleanups.delete(cleanup);
      };
    },
    () => cleanups.forEach((fn) => fn()),
  ];
}
