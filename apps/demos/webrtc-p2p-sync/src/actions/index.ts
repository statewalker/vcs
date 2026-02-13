/**
 * Action adapters for type-safe communication between Views and Controllers.
 *
 * @example
 * ```typescript
 * import { enqueueAddFileAction, listenAddFileAction } from "../actions/index.js";
 *
 * // In views - enqueue actions
 * enqueueAddFileAction(userActions, { name: "test.txt", content: "hello" });
 *
 * // In controllers - listen for actions
 * listenAddFileAction(userActions, (actions) => {
 *   for (const { name, content } of actions) {
 *     await writeFile(name, content);
 *   }
 * });
 * ```
 */

// Commit actions
export {
  type CreateCommitPayload,
  enqueueCreateCommitAction,
  listenCreateCommitAction,
} from "./commit-actions.js";

// Connection actions
export {
  enqueueDisconnectAction,
  enqueueJoinAction,
  enqueueShareAction,
  type JoinPayload,
  listenDisconnectAction,
  listenJoinAction,
  listenShareAction,
} from "./connection-actions.js";

// File actions
export {
  type AddFilePayload,
  enqueueAddFileAction,
  enqueueStageAllAction,
  enqueueStageFileAction,
  enqueueUnstageFileAction,
  type FilePathPayload,
  listenAddFileAction,
  listenStageAllAction,
  listenStageFileAction,
  listenUnstageFileAction,
} from "./file-actions.js";

// Repository actions
export {
  enqueueCheckoutAction,
  enqueueInitRepoAction,
  enqueueOpenRepoAction,
  enqueueRefreshRepoAction,
  listenCheckoutAction,
  listenInitRepoAction,
  listenOpenRepoAction,
  listenRefreshRepoAction,
} from "./repo-actions.js";

// Storage actions
export {
  enqueueClearStorageAction,
  enqueueOpenStorageAction,
  listenClearStorageAction,
  listenOpenStorageAction,
} from "./storage-actions.js";

// Sync actions
export {
  enqueueCancelSyncAction,
  enqueueStartSyncAction,
  listenCancelSyncAction,
  listenStartSyncAction,
  type StartSyncPayload,
} from "./sync-actions.js";
