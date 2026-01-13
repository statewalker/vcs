/**
 * Base class providing observable state pattern.
 * All models extend this class for change notification.
 */
export class BaseClass {
  #listeners: Set<() => void> = new Set();

  /**
   * Subscribe to state changes.
   * @param listener Callback invoked when state changes
   * @returns Cleanup function to unsubscribe
   */
  onUpdate(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Notify all listeners of a state change.
   * Call this from subclasses when state is modified.
   */
  protected notify(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
