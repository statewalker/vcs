/**
 * Commit-related actions.
 */

import { newUserAction } from "../utils/index.js";

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
export const [enqueueCreateCommit, listenCreateCommit] =
  newUserAction<CreateCommitPayload>("commit:create");
