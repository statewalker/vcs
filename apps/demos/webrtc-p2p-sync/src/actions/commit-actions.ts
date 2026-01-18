/**
 * Commit-related actions.
 */

import { newUserAction } from "../models/user-actions-model.js";

/**
 * Payload for creating a commit.
 */
export type CreateCommitPayload = {
  /** Commit message. */
  message: string;
};

/**
 * Request to create a commit.
 */
export const [enqueueCreateCommitAction, listenCreateCommitAction] =
  newUserAction<CreateCommitPayload>("commit:create");
