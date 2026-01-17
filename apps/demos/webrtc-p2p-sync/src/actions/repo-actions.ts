/**
 * Repository-related actions.
 */

import { newUserAction } from "../utils/index.js";

/**
 * Request to initialize a new repository.
 */
export const [enqueueInitRepo, listenInitRepo] = newUserAction("repo:init");

/**
 * Request to refresh repository state.
 */
export const [enqueueRefreshRepo, listenRefreshRepo] = newUserAction("repo:refresh");

/**
 * Request to checkout HEAD (update working directory from commit).
 */
export const [enqueueCheckout, listenCheckout] = newUserAction("repo:checkout");
