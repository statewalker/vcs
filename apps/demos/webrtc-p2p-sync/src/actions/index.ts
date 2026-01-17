/**
 * Action adapters for type-safe communication between Views and Controllers.
 *
 * @example
 * ```typescript
 * import { enqueueAddFile, listenAddFile } from "../actions/index.js";
 *
 * // In views - enqueue actions
 * enqueueAddFile(userActions, { name: "test.txt", content: "hello" });
 *
 * // In controllers - listen for actions
 * listenAddFile(userActions, (actions) => {
 *   for (const { name, content } of actions) {
 *     await writeFile(name, content);
 *   }
 * });
 * ```
 */

// Commit actions
export {
  type CreateCommitPayload,
  enqueueCreateCommit,
  listenCreateCommit,
} from "./commit-actions.js";
// Connection actions
export {
  enqueueDisconnect,
  enqueueJoin,
  enqueueShare,
  type JoinPayload,
  listenDisconnect,
  listenJoin,
  listenShare,
} from "./connection-actions.js";

// File actions
export {
  type AddFilePayload,
  enqueueAddFile,
  enqueueStageAll,
  enqueueStageFile,
  enqueueUnstageFile,
  type FilePathPayload,
  listenAddFile,
  listenStageAll,
  listenStageFile,
  listenUnstageFile,
} from "./file-actions.js";
// Repository actions
export {
  enqueueCheckout,
  enqueueInitRepo,
  enqueueRefreshRepo,
  listenCheckout,
  listenInitRepo,
  listenRefreshRepo,
} from "./repo-actions.js";
// Storage actions
export {
  enqueueClearStorage,
  enqueueOpenStorage,
  listenClearStorage,
  listenOpenStorage,
} from "./storage-actions.js";

// Sync actions
export {
  enqueueCancelSync,
  enqueueStartSync,
  listenCancelSync,
  listenStartSync,
  type StartSyncPayload,
} from "./sync-actions.js";
