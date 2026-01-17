/**
 * Action Adapter Pattern
 *
 * This module provides a pattern for type-safe, decoupled communication between
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
 * ## Comparison to Other Patterns
 *
 * | Feature              | Action Adapters | Redux Dispatch | Command Pattern |
 * |----------------------|-----------------|----------------|-----------------|
 * | Type safety          | ✓ Full          | ✓ With types   | ✓ Per command   |
 * | Decoupled            | ✓               | ✓              | ✗ Direct call   |
 * | Multi-listener       | ✓               | ✗ Single store | ✗               |
 * | Batching             | ✓ Automatic     | ✗              | ✗               |
 * | Payload flexibility  | ✓ Generic       | ✓              | ✓               |
 *
 * ## Usage
 *
 * ### 1. Define Action Adapters (in actions/*.ts)
 *
 * ```typescript
 * // actions/file-actions.ts
 * import { newUserAction } from "../utils/user-action.js";
 *
 * // Action with typed payload
 * type AddFilePayload = { name: string; content: string };
 * export const [enqueueAddFile, listenAddFile] =
 *   newUserAction<AddFilePayload>("file:add");
 *
 * // Action without payload (void)
 * export const [enqueueRefresh, listenRefresh] =
 *   newUserAction("repo:refresh");
 * ```
 *
 * ### 2. Enqueue from Views
 *
 * ```typescript
 * // views/file-form-view.ts
 * import { enqueueAddFile } from "../actions/file-actions.js";
 *
 * class FileFormView {
 *   private handleSubmit(name: string, content: string): void {
 *     enqueueAddFile(this.actionsModel, { name, content });
 *   }
 * }
 * ```
 *
 * ### 3. Listen in Controllers
 *
 * ```typescript
 * // controllers/file-controller.ts
 * import { listenAddFile } from "../actions/file-actions.js";
 *
 * function createFileController(ctx: AppContext): () => void {
 *   const actionsModel = getUserActionsModel(ctx);
 *
 *   const unsubscribe = listenAddFile(actionsModel, (actions) => {
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

import type { UserActionsModel } from "../models/user-actions-model.js";

/**
 * Handler function for action listeners.
 */
export type ActionListener<T> = (actions: T[]) => void;

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
 * const [enqueueCommit, listenCommit] = newUserAction<CommitPayload>("commit:create");
 * enqueueCommit(model, { message: "Initial commit" });
 *
 * // Action without payload (void)
 * const [enqueueRefresh, listenRefresh] = newUserAction("repo:refresh");
 * enqueueRefresh(model);
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
