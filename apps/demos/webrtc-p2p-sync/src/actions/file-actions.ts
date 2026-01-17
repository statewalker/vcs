/**
 * File-related actions.
 */

import { newUserAction } from "../utils/index.js";

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
export const [enqueueAddFile, listenAddFile] = newUserAction<AddFilePayload>("file:add");

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
export const [enqueueStageFile, listenStageFile] = newUserAction<FilePathPayload>("file:stage");

/**
 * Request to unstage a file.
 */
export const [enqueueUnstageFile, listenUnstageFile] =
  newUserAction<FilePathPayload>("file:unstage");

/**
 * Request to stage all changes.
 */
export const [enqueueStageAll, listenStageAll] = newUserAction("stage:all");
