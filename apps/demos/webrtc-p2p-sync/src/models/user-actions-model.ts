/**
 * User Actions Model and Action Adapter Pattern
 *
 * This module provides a type-safe, decoupled communication pattern between
 * Views and Controllers in the application architecture.
 *
 * ## Pattern Overview
 *
 * The action adapter pattern creates paired enqueue/listen functions that:
 * - **Encapsulate action types** - No string literals scattered across the codebase
 * - **Provide type safety** - Payload types are enforced at compile time
 * - **Enable multi-listener** - Multiple controllers can respond to the same action
 * - **Support batching** - Multiple enqueues in the same tick are delivered together
 *
 * ## Usage
 *
 * ### 1. Define Action Adapters (in actions/*.ts)
 *
 * ```typescript
 * // actions/file-actions.ts
 * import { newUserAction } from "../models/user-actions-model.js";
 *
 * // Action with typed payload
 * type AddFilePayload = { name: string; content: string };
 * export const [enqueueAddFileAction, listenAddFileAction] =
 *   newUserAction<AddFilePayload>("file:add");
 *
 * // Action without payload (void)
 * export const [enqueueRefreshAction, listenRefreshAction] =
 *   newUserAction("repo:refresh");
 * ```
 *
 * ### 2. Enqueue from Views
 *
 * ```typescript
 * // views/file-form-view.ts
 * import { enqueueAddFileAction } from "../actions/file-actions.js";
 *
 * class FileFormView {
 *   private handleSubmit(name: string, content: string): void {
 *     enqueueAddFileAction(this.actionsModel, { name, content });
 *   }
 * }
 * ```
 *
 * ### 3. Listen in Controllers
 *
 * ```typescript
 * // controllers/file-controller.ts
 * import { listenAddFileAction } from "../actions/file-actions.js";
 *
 * function createFileController(ctx: AppContext): () => void {
 *   const actionsModel = getUserActionsModel(ctx);
 *
 *   const unsubscribe = listenAddFileAction(actionsModel, (actions) => {
 *     for (const { name, content } of actions) {
 *       await this.writeFile(name, content);
 *     }
 *   });
 *
 *   return unsubscribe;
 * }
 * ```
 *
 * ## Key Benefits
 *
 * - **Centralized declarations**: All action types in one place (`actions/`)
 * - **Refactoring safety**: Rename adapter → compiler finds all usages
 * - **IDE support**: Autocomplete for enqueue/listen and payloads
 * - **Testing**: Easy to test action flow in isolation
 */

import { BaseClass, newAdapter } from "../utils/index.js";

/**
 * Handler function for action listeners.
 */
export type ActionListener<T> = (actions: T[]) => void;

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

/**
 * Creates a type-safe action adapter for enqueueing and listening to actions.
 *
 * @param type - The unique action type string (e.g., "repo:init", "file:add")
 * @returns Tuple of [enqueue, listen] functions
 *
 * @example
 * ```typescript
 * // Action with payload
 * type CommitPayload = { message: string };
 * const [enqueueCommitAction, listenCommitAction] = newUserAction<CommitPayload>("commit:create");
 * enqueueCommitAction(model, { message: "Initial commit" });
 *
 * // Action without payload (void)
 * const [enqueueRefreshAction, listenRefreshAction] = newUserAction("repo:refresh");
 * enqueueRefreshAction(model);
 * ```
 */
export function newUserAction<T = void>(
  type: string,
): [
  enqueue: T extends void
    ? (model: UserActionsModel) => void
    : (model: UserActionsModel, payload: T) => void,
  listen: (model: UserActionsModel, handler: ActionListener<T>) => () => void,
] {
  function enqueue(model: UserActionsModel, payload?: T): void {
    model.enqueue(type, payload);
  }

  function listen(model: UserActionsModel, handler: ActionListener<T>): () => void {
    return model.onActionUpdate(type, handler as ActionListener<unknown>);
  }

  return [enqueue as never, listen];
}
