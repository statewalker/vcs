/**
 * User actions model - communication channel from Views to Controllers.
 *
 * Views enqueue actions via adapter functions (e.g., `enqueueInitRepo(model, payload)`).
 * Controllers listen via adapter functions (e.g., `listenInitRepo(model, handler)`).
 *
 * This pattern ensures Views never call APIs directly and provides type-safe
 * action handling with multi-listener support.
 *
 * @example
 * ```typescript
 * // Define action adapter
 * const [enqueueRefresh, listenRefresh] = newUserAction("repo:refresh");
 *
 * // View enqueues
 * enqueueRefresh(userActions);
 *
 * // Controller listens
 * listenRefresh(userActions, (actions) => {
 *   console.log(`Received ${actions.length} refresh actions`);
 * });
 * ```
 */

import { BaseClass, newAdapter } from "../utils/index.js";

/**
 * User actions model - type-safe action queue with multi-listener support.
 *
 * Actions are enqueued via `enqueue()` and dispatched to listeners via `onActionUpdate()`.
 * Multiple enqueues in the same tick are batched together.
 * All listeners for a type receive the same actions, then actions are cleared.
 */
export class UserActionsModel extends BaseClass {
  private pendingActionsByType: Map<string, unknown[]> = new Map();
  private typeListeners: Map<string, Set<(actions: unknown[]) => void>> = new Map();
  private dispatchScheduled = false;

  /**
   * Enqueue an action of a specific type.
   * Called by action adapters created with `newUserAction()`.
   *
   * @param type - The action type string
   * @param payload - The action payload (type depends on action)
   * @internal
   */
  enqueue(type: string, payload: unknown): void {
    const actions = this.pendingActionsByType.get(type) ?? [];
    actions.push(payload);
    this.pendingActionsByType.set(type, actions);
    this.scheduleDispatch();
  }

  /**
   * Subscribe to actions of a specific type.
   * All listeners for a type receive the same actions.
   * Actions are cleared after all listeners are notified.
   *
   * @param type - Action type to listen for
   * @param handler - Callback receiving array of action payloads
   * @returns Unsubscribe function
   * @internal
   */
  onActionUpdate(type: string, handler: (actions: unknown[]) => void): () => void {
    let listeners = this.typeListeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.typeListeners.set(type, listeners);
    }
    listeners.add(handler);
    return () => listeners.delete(handler);
  }

  /**
   * Schedule dispatch for next microtask (enables batching).
   */
  private scheduleDispatch(): void {
    if (this.dispatchScheduled) return;
    this.dispatchScheduled = true;
    queueMicrotask(() => {
      this.dispatchScheduled = false;
      this.dispatchAll();
    });
  }

  /**
   * Dispatch all pending actions to their listeners, then clear.
   */
  private dispatchAll(): void {
    for (const [type, actions] of this.pendingActionsByType) {
      if (actions.length === 0) continue;
      const listeners = this.typeListeners.get(type);
      if (listeners && listeners.size > 0) {
        for (const handler of listeners) {
          try {
            handler([...actions]); // Copy to prevent mutation
          } catch (error) {
            console.error(`Error in action handler for "${type}":`, error);
          }
        }
      }
    }
    this.pendingActionsByType.clear();
    this.notify();
  }

  /**
   * Clear all pending actions.
   */
  clear(): void {
    this.pendingActionsByType.clear();
  }
}

/**
 * Context adapter for UserActionsModel.
 */
export const [getUserActionsModel, setUserActionsModel] = newAdapter<UserActionsModel>(
  "user-actions-model",
  () => new UserActionsModel(),
);
