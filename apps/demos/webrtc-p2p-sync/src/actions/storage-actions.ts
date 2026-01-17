/**
 * Storage-related actions.
 */

import { newUserAction } from "../utils/index.js";

/**
 * Request to open storage (IndexedDB).
 */
export const [enqueueOpenStorage, listenOpenStorage] = newUserAction("storage:open");

/**
 * Request to clear storage.
 */
export const [enqueueClearStorage, listenClearStorage] = newUserAction("storage:clear");
