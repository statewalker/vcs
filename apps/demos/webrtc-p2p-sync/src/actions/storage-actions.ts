/**
 * Storage-related actions.
 */

import { newUserAction } from "../models/user-actions-model.js";

/**
 * Request to open storage (IndexedDB).
 */
export const [enqueueOpenStorageAction, listenOpenStorageAction] = newUserAction("storage:open");

/**
 * Request to clear storage.
 */
export const [enqueueClearStorageAction, listenClearStorageAction] = newUserAction("storage:clear");
