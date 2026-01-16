/**
 * Main controller - orchestrates all other controllers.
 *
 * This is the entry point for the controller layer.
 * It initializes all controllers and provides a single cleanup function.
 */

import { newRegistry } from "../utils/index.js";
import type { AppContext } from "./index.js";
import { createRepositoryController } from "./repository-controller.js";
import { createSessionController } from "./session-controller.js";
import { createSyncController } from "./sync-controller.js";

/**
 * Create the main controller that orchestrates all other controllers.
 *
 * @param ctx The application context
 * @returns Cleanup function to destroy all controllers
 */
export function createMainController(ctx: AppContext): () => void {
  const [register, cleanup] = newRegistry();

  // Initialize all controllers
  register(createSessionController(ctx));
  register(createSyncController(ctx));
  register(createRepositoryController(ctx));

  return cleanup;
}
