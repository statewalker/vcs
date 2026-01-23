/**
 * Main Controller
 *
 * Orchestrates all other controllers and manages the application startup sequence.
 * Sets up inter-model coordination and initializes the app context.
 * Subscribes to UserActionsModel to handle user-initiated actions.
 */

import {
  getActivityLogModel,
  getCommitFormModel,
  getCommitHistoryModel,
  getConnectionModel,
  getFileListModel,
  getRepositoryModel,
  getSharingFormModel,
  getStagingModel,
  getUserActionsModel,
} from "../models/index.js";
import { newRegistry } from "../utils/index.js";
import {
  commit,
  createRepositoryController,
  createSampleFiles,
  initOrOpenRepository,
  refreshFiles,
  restoreToCommit,
  stageFile,
  unstageFile,
} from "./repository-controller.js";
import { createStorageController, openFolder, useMemoryStorage } from "./storage-controller.js";
import { createSyncController, fetchFromRemote, pushToRemote } from "./sync-controller.js";
import {
  acceptAnswer,
  acceptOffer,
  closeConnection,
  createOffer,
  createWebRtcController,
} from "./webrtc-controller.js";

/**
 * Application context type.
 */
export type AppContext = Map<string, unknown>;

/**
 * Create a new application context with all models initialized.
 */
export function createAppContext(): AppContext {
  const ctx: AppContext = new Map();

  // Initialize all models (they are lazy-created by adapters)
  getRepositoryModel(ctx);
  getFileListModel(ctx);
  getStagingModel(ctx);
  getCommitHistoryModel(ctx);
  getCommitFormModel(ctx);
  getConnectionModel(ctx);
  getSharingFormModel(ctx);
  getActivityLogModel(ctx);
  getUserActionsModel(ctx);

  return ctx;
}

/**
 * Create the main controller that orchestrates all other controllers.
 * Returns cleanup function.
 */
export function createMainController(ctx: AppContext): () => void {
  const [register, cleanup] = newRegistry();
  const logModel = getActivityLogModel(ctx);

  // Initialize all sub-controllers
  register(createStorageController(ctx));
  register(createRepositoryController(ctx));
  register(createWebRtcController(ctx));
  register(createSyncController(ctx));

  // Set up inter-model coordination

  // When repository status changes, log it
  const repoModel = getRepositoryModel(ctx);
  register(
    repoModel.onUpdate(() => {
      // Status logging is handled by individual controllers
    }),
  );

  // When connection state changes, update sharing form appropriately
  const connectionModel = getConnectionModel(ctx);
  const sharingModel = getSharingFormModel(ctx);
  register(
    connectionModel.onUpdate(() => {
      if (connectionModel.state === "connected") {
        sharingModel.reset();
      }
    }),
  );

  // When staging changes, update commit form validity indicator
  const stagingModel = getStagingModel(ctx);
  const _commitFormModel = getCommitFormModel(ctx);
  register(
    stagingModel.onUpdate(() => {
      // Views will check stagingModel.isEmpty to enable/disable commit
    }),
  );

  // Subscribe to UserActionsModel and handle user-initiated actions
  const actionsModel = getUserActionsModel(ctx);
  register(
    actionsModel.onUpdate(() => {
      // Handle storage actions
      const storageAction = actionsModel.storageAction;
      if (storageAction) {
        actionsModel.clearStorageAction();
        handleStorageAction(ctx, storageAction.type);
      }

      // Handle file actions
      const fileAction = actionsModel.fileAction;
      if (fileAction) {
        actionsModel.clearFileAction();
        if (fileAction.type === "refresh") {
          refreshFiles(ctx);
        } else if (fileAction.type === "stage") {
          stageFile(ctx, fileAction.path);
        } else if (fileAction.type === "unstage") {
          unstageFile(ctx, fileAction.path);
        }
      }

      // Handle commit actions
      const commitAction = actionsModel.commitAction;
      if (commitAction) {
        actionsModel.clearCommitAction();
        if (commitAction.type === "commit") {
          commit(ctx, commitAction.message);
        } else if (commitAction.type === "restore") {
          restoreToCommit(ctx, commitAction.commitId);
        }
      }

      // Handle connection actions
      const connectionAction = actionsModel.connectionAction;
      if (connectionAction) {
        actionsModel.clearConnectionAction();
        if (connectionAction.type === "create-offer") {
          createOffer(ctx);
        } else if (connectionAction.type === "accept-offer") {
          acceptOffer(ctx, connectionAction.payload);
        } else if (connectionAction.type === "accept-answer") {
          acceptAnswer(ctx, connectionAction.payload);
        } else if (connectionAction.type === "close-connection") {
          closeConnection(ctx);
        }
      }

      // Handle sync actions
      const syncAction = actionsModel.syncAction;
      if (syncAction) {
        actionsModel.clearSyncAction();
        if (syncAction.type === "push") {
          pushToRemote(ctx);
        } else if (syncAction.type === "fetch") {
          fetchFromRemote(ctx);
        }
      }
    }),
  );

  logModel.info("Application initialized");

  return cleanup;
}

/**
 * Handle storage-related actions.
 */
async function handleStorageAction(
  ctx: AppContext,
  actionType: "open-folder" | "use-memory" | "init-repository" | "create-samples",
): Promise<void> {
  switch (actionType) {
    case "open-folder": {
      const backend = await openFolder(ctx);
      if (backend) {
        await initOrOpenRepository(ctx);
      }
      break;
    }
    case "use-memory": {
      await useMemoryStorage(ctx);
      await initOrOpenRepository(ctx);
      break;
    }
    case "init-repository": {
      await initOrOpenRepository(ctx);
      break;
    }
    case "create-samples": {
      await createSampleFiles(ctx);
      break;
    }
  }
}

export {
  commit,
  createSampleFiles,
  getGit,
  getGitStore,
  initOrOpenRepository,
  loadHistory,
  refreshFiles,
  restoreToCommit,
  stageFile,
  startAutoRefresh,
  stopAutoRefresh,
  unstageFile,
} from "./repository-controller.js";
// Re-export controller functions for convenience
export {
  closeStorage,
  getStorageBackend,
  isFileSystemAccessSupported,
  openFolder,
  useMemoryStorage,
} from "./storage-controller.js";
export {
  detectConflicts,
  fetchFromRemote,
  pushToRemote,
  resolveConflict,
} from "./sync-controller.js";
export {
  acceptAnswer,
  acceptOffer,
  closeConnection,
  createOffer,
  isConnected,
} from "./webrtc-controller.js";
