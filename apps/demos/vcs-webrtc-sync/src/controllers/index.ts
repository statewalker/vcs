// Re-export all controller functionality from main-controller
export {
  type AppContext,
  acceptAnswer,
  acceptOffer,
  closeConnection,
  closeStorage,
  commit,
  // App initialization
  createAppContext,
  createMainController,
  // WebRTC operations
  createOffer,
  createSampleFiles,
  detectConflicts,
  fetchFromRemote,
  getGit,
  getGitStore,
  getStorageBackend,
  getTransportConnection,
  initializeApp,
  // Repository operations
  initOrOpenRepository,
  isConnected,
  isFileSystemAccessSupported,
  loadHistory,
  // Storage operations
  openFolder,
  // Sync operations
  pushToRemote,
  refreshFiles,
  resolveConflict,
  restoreToCommit,
  stageFile,
  startAutoRefresh,
  stopAutoRefresh,
  unstageFile,
  useMemoryStorage,
} from "./main-controller.js";

// Export storage types
export type { StorageBackend, StorageType } from "./storage-controller.js";
