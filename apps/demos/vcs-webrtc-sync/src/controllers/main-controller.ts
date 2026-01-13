/**
 * Main Controller
 *
 * Orchestrates all other controllers and manages the application startup sequence.
 * Sets up inter-model coordination and initializes the app context.
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
} from "../models/index.js";
import { newRegistry } from "../utils/index.js";
import { createRepositoryController } from "./repository-controller.js";
import { createStorageController } from "./storage-controller.js";
import { createSyncController } from "./sync-controller.js";
import { createWebRtcController } from "./webrtc-controller.js";

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

  logModel.info("Application initialized");

  return cleanup;
}

/**
 * Initialize the application.
 * Creates context, controllers, and returns cleanup function.
 */
export function initializeApp(): { ctx: AppContext; cleanup: () => void } {
  const ctx = createAppContext();
  const cleanup = createMainController(ctx);

  return { ctx, cleanup };
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
  getTransportConnection,
  isConnected,
} from "./webrtc-controller.js";
