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

import {
  type AppContext,
  createAppContext,
  createControllers,
  getIntents,
} from "./controllers/index.js";
import { handleOpenRepositoryIntent } from "./intents/index.js";
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
 * Create all application views and bind them to DOM elements.
 *
 * @param ctx The application context
 * @returns Cleanup function to destroy all views
 */
function createViews(ctx: AppContext): () => void {
  const [register, cleanup] = newRegistry();

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

  return cleanup;
}

/**
 * Check if the File System Access API is available (desktop browsers).
 */
function supportsFileSystemAccess(): boolean {
  return typeof (globalThis as Record<string, unknown>).showDirectoryPicker === "function";
}

/**
 * Register browser-specific intent handlers.
 *
 * Desktop: opens native folder picker via File System Access API.
 * Mobile/fallback: creates an in-memory FilesApi.
 */
function setupBrowserIntents(ctx: AppContext): () => void {
  const intents = getIntents(ctx);

  return handleOpenRepositoryIntent(intents, (intent) => {
    if (supportsFileSystemAccess()) {
      // Desktop path — open native folder picker, then wrap in FilesApi
      intent.resolve(
        (async () => {
          const handle = await (
            globalThis as unknown as {
              showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
            }
          ).showDirectoryPicker();
          const { BrowserFilesApi } = await import("@statewalker/webrun-files-browser");
          const files = new BrowserFilesApi({ rootHandle: handle });
          return { files, label: handle.name };
        })(),
      );
    } else {
      // Mobile / no File System Access API — use in-memory storage
      import("@statewalker/webrun-files-mem").then(async ({ MemFilesApi }) => {
        intent.resolve({ files: new MemFilesApi(), label: "In-Memory" });
      });
    }
    return true;
  });
}

/**
 * Initialize the application.
 */
async function initializeApp(): Promise<() => void> {
  // Create application context with APIs
  const ctx: AppContext = await createAppContext();

  // Registry for cleanup
  const [register, cleanup] = newRegistry();

  // Register browser intent handlers
  register(setupBrowserIntents(ctx));

  // Create controllers (handle business logic)
  register(createControllers(ctx));

  // Create views (bind to DOM elements)
  register(createViews(ctx));

  // Pre-fill session ID from URL if present
  const sessionModel = getSessionModel(ctx);
  const logModel = getActivityLogModel(ctx);

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
