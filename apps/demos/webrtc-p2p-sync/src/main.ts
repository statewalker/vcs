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
import { BrowserFilesApi } from "@statewalker/webrun-files-browser";
import { MemFilesApi } from "@statewalker/webrun-files-mem";

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
 * Register browser-specific intent handlers.
 *
 * Opens a native folder picker via the File System Access API
 * using openBrowserFilesApi from @statewalker/webrun-files-browser.
 */
function setupBrowserIntents(ctx: AppContext): () => void {
  const intents = getIntents(ctx);
  const logModel = getActivityLogModel(ctx);

  return handleOpenRepositoryIntent(intents, (intent) => {
    // Call intent.resolve() synchronously with a promise so that
    // intent.resolved is true when run() returns.
    intent.resolve(
      (async () => {
        if (
          typeof (globalThis as unknown as Record<string, unknown>).showDirectoryPicker ===
          "function"
        ) {
          // Desktop browsers with File System Access API
          // Must call showDirectoryPicker with { mode: "readwrite" } directly —
          // the library's openBrowserFilesApi() omits the mode, getting a read-only
          // handle then trying to upgrade via verifyPermission() which fails
          // because the user gesture has expired by this point in the async chain.
          const rootHandle: FileSystemDirectoryHandle = await (
            globalThis as unknown as {
              showDirectoryPicker: (opts: {
                mode: string;
              }) => Promise<FileSystemDirectoryHandle>;
            }
          ).showDirectoryPicker({ mode: "readwrite" });
          const files = new BrowserFilesApi({ rootHandle });
          return { files, label: rootHandle.name };
        } else {
          // Mobile browsers or environments without File System Access API
          logModel.info("File System Access API not available, using in-memory storage.");
          return { files: new MemFilesApi(), label: "In-Memory" };
        }
      })(),
    );
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
