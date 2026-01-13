/**
 * VCS WebRTC Sync Demo - Entry Point
 *
 * Browser-based Git repository management with WebRTC P2P synchronization.
 */

import { initializeApp } from "./controllers/index.js";
import { createMainView } from "./views/index.js";

/**
 * Main application entry point.
 */
async function main(): Promise<void> {
  // Initialize the application (models and controllers)
  const { ctx, cleanup: cleanupControllers } = initializeApp();

  // Set up the UI views
  const cleanupViews = createMainView(ctx);

  // Store cleanup for potential hot reload or app shutdown
  (window as unknown as { __appCleanup?: () => void }).__appCleanup = () => {
    cleanupViews();
    cleanupControllers();
  };

  console.log("VCS WebRTC Sync Demo initialized");
}

// Start the application when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
