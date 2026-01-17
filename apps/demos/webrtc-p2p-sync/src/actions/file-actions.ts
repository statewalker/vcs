/**
 * File-related actions.
 */

import { newUserAction } from "../models/user-actions-model.js";

/**
 * Payload for adding a new file.
 */
export type AddFilePayload = {
  /** File name. */
  name: string;
  /** File content. */
  content: string;
};

/**
 * Request to add a new file.
 */
export const [enqueueAddFileAction, listenAddFileAction] =
  newUserAction<AddFilePayload>("file:add");

/**
 * Payload for staging/unstaging a file.
 */
export type FilePathPayload = {
  /** File path. */
  path: string;
};

/**
 * Request to stage a file for commit.
 */
export const [enqueueStageFileAction, listenStageFileAction] =
  newUserAction<FilePathPayload>("file:stage");

/**
 * Request to unstage a file.
 */
export const [enqueueUnstageFileAction, listenUnstageFileAction] =
  newUserAction<FilePathPayload>("file:unstage");

/**
 * Request to stage all changes.
 */
export const [enqueueStageAllAction, listenStageAllAction] = newUserAction("stage:all");
