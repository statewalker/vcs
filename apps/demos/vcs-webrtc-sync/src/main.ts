/**
 * VCS WebRTC Sync Demo - Entry Point
 *
 * Browser-based Git repository management with WebRTC P2P synchronization.
 */

import { createAppContext } from "./controllers/index.js";
import { createMainController } from "./controllers/main-controller.js";
import { newRegistry } from "./utils/registry.js";
import { createMainView } from "./views/index.js";

/**
 * Main application entry point.
 */
async function main(): Promise<void> {
  const [record, cleanup] = newRegistry();
  // Store cleanup for potential hot reload or app shutdown
  (window as unknown as { __appCleanup?: () => void }).__appCleanup = cleanup;

  const ctx = createAppContext();
  const cleanupController = createMainController(ctx);
  record(cleanupController);

  // Set up the UI views
  const cleanupViews = createMainView(ctx);
  record(cleanupViews);

  console.log("VCS WebRTC Sync Demo initialized");
}

// Start the application when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
