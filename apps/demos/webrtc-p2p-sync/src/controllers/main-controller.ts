/**
 * Controllers factory - orchestrates all controllers.
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
 * Create all application controllers.
 *
 * @param ctx The application context
 * @returns Cleanup function to destroy all controllers
 */
export function createControllers(ctx: AppContext): () => void {
  const [register, cleanup] = newRegistry();

  // Initialize all controllers
  register(createSessionController(ctx));
  register(createSyncController(ctx));
  register(createRepositoryController(ctx));

  return cleanup;
}
