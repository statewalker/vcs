/**
 * Repository-related actions.
 */

import { newUserAction } from "../models/user-actions-model.js";

/**
 * Request to initialize a new repository.
 */
export const [enqueueInitRepoAction, listenInitRepoAction] = newUserAction("repo:init");

/**
 * Request to refresh repository state.
 */
export const [enqueueRefreshRepoAction, listenRefreshRepoAction] = newUserAction("repo:refresh");

/**
 * Request to checkout HEAD (update working directory from commit).
 */
export const [enqueueCheckoutAction, listenCheckoutAction] = newUserAction("repo:checkout");
