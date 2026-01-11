/**
 * Browser VCS App - Main Entry Point
 *
 * Demonstrates Git operations in the browser using WebRun VCS
 * with swappable storage backends (in-memory or File System Access API).
 */

import { createApp } from "./app.js";

// Wait for DOM to be ready
document.addEventListener("DOMContentLoaded", async () => {
  // Check File System Access API support
  const fsApiSupport = document.getElementById("fs-api-support")!;
  const isSupported = "showDirectoryPicker" in window;

  if (isSupported) {
    fsApiSupport.textContent = "Supported";
    fsApiSupport.className = "supported";
  } else {
    fsApiSupport.textContent = "Not Supported (in-memory only)";
    fsApiSupport.className = "unsupported";

    // Disable browser filesystem button
    const browserFsBtn = document.getElementById("btn-browser-fs") as HTMLButtonElement;
    browserFsBtn.disabled = true;
    browserFsBtn.title = "File System Access API is not supported in this browser";
  }

  // Initialize the app
  try {
    await createApp();
  } catch (error) {
    console.error("Failed to initialize app:", error);
  }
});
