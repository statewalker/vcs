/**
 * WebRTC P2P Git Sync Demo - Main Entry Point
 *
 * This demo demonstrates peer-to-peer repository synchronization using
 * WebRTC data channels with PeerJS for signaling.
 *
 * Architecture:
 * - MVC pattern with context-based dependency injection
 * - Models: Pure data containers with change notifications
 * - Views: UI rendering, update UserActionsModel on user input
 * - Controllers: Business logic, API interactions, update Models
 */

import { type AppContext, createAppContext, createMainController } from "./controllers/index.js";
import { parseSessionIdFromUrl } from "./lib/index.js";
import { getActivityLogModel, getSessionModel } from "./models/index.js";
import { newRegistry } from "./utils/index.js";
import {
  createActivityLogView,
  createCommitHistoryView,
  createConnectionView,
  createFileListView,
  createSharingView,
  createStorageView,
} from "./views/index.js";

/**
 * Initialize the application.
 */
async function initializeApp(): Promise<() => void> {
  // Create application context with all models and APIs
  const ctx: AppContext = await createAppContext();

  // Registry for cleanup
  const [register, cleanup] = newRegistry();

  // Get models for initialization
  const sessionModel = getSessionModel(ctx);
  const logModel = getActivityLogModel(ctx);

  // Create views (bind to DOM elements)
  const connectionPanel = document.getElementById("connection-panel");
  const sharingPanel = document.getElementById("sharing-panel");
  const storagePanel = document.getElementById("storage-panel");
  const filesPanel = document.getElementById("files-panel");
  const historyPanel = document.getElementById("history-panel");
  const logPanel = document.getElementById("log-panel");

  if (connectionPanel) {
    register(createConnectionView(ctx, connectionPanel));
  }

  if (sharingPanel) {
    register(createSharingView(ctx, sharingPanel));
  }

  if (storagePanel) {
    register(createStorageView(ctx, storagePanel));
  }

  if (filesPanel) {
    register(createFileListView(ctx, filesPanel));
  }

  if (historyPanel) {
    register(createCommitHistoryView(ctx, historyPanel));
  }

  if (logPanel) {
    register(createActivityLogView(ctx, logPanel));
  }

  // Create controllers (handle business logic)
  register(createMainController(ctx));

  // Pre-fill session ID from URL if present
  const urlSessionId = parseSessionIdFromUrl(window.location.href);
  if (urlSessionId) {
    sessionModel.setJoinInputValue(urlSessionId);
    logModel.info(`Session ID detected in URL: ${urlSessionId}`);
    logModel.info('Click "Join" to connect to the session.');
  }

  // Log startup
  logModel.info("Application started");
  logModel.info("Initialize a repository or join a session to begin.");

  return cleanup;
}

// Initialize on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", async () => {
    const cleanup = await initializeApp();
    window.addEventListener("beforeunload", cleanup);
  });
} else {
  initializeApp().then((cleanup) => {
    window.addEventListener("beforeunload", cleanup);
  });
}
