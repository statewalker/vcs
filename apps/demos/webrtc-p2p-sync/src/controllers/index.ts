/**
 * Controllers index - exports all controllers and app context utilities.
 */

import type { PeerConnection, PeerInstance } from "../apis/index.js";
import {
  createRealPeerJsApi,
  createRealTimerApi,
  setPeerJsApi,
  setTimerApi,
} from "../apis/index.js";
import {
  getActivityLogModel,
  getPeersModel,
  getRepositoryModel,
  getSessionModel,
  getSyncModel,
  getUserActionsModel,
} from "../models/index.js";
import { newAdapter } from "../utils/index.js";
import type { GitStore } from "./repository-controller.js";

/**
 * Application context type.
 * A simple record that holds all models, APIs, and shared state.
 */
export type AppContext = Record<string, unknown>;

/**
 * Context adapter for PeerJS peer instance.
 */
export const [getPeerInstance, setPeerInstance] = newAdapter<PeerInstance | null>(
  "peer-instance",
  () => null,
);

/**
 * Context adapter for active peer connections.
 */
export const [getPeerConnections, setPeerConnections] = newAdapter<Map<string, PeerConnection>>(
  "peer-connections",
  () => new Map(),
);

/**
 * Context adapter for Git store.
 */
export const [getGitStore, setGitStore] = newAdapter<GitStore | null>("git-store", () => null);

/**
 * Create and initialize the application context.
 *
 * This sets up all models and injects the real API implementations.
 *
 * @returns Initialized application context
 */
export async function createAppContext(): Promise<AppContext> {
  const ctx: AppContext = {};

  // Initialize all models (lazy-created by adapters)
  getSessionModel(ctx);
  getPeersModel(ctx);
  getSyncModel(ctx);
  getRepositoryModel(ctx);
  getActivityLogModel(ctx);
  getUserActionsModel(ctx);

  // Initialize state storage
  getPeerInstance(ctx);
  getPeerConnections(ctx);
  getGitStore(ctx);

  // Inject real API implementations
  setPeerJsApi(ctx, await createRealPeerJsApi());
  setTimerApi(ctx, createRealTimerApi());

  return ctx;
}

/**
 * Create a test context with mock APIs.
 *
 * Use this in unit tests to inject mock implementations.
 *
 * @returns Test context (without real APIs - you must inject mocks)
 */
export function createTestContext(): AppContext {
  const ctx: AppContext = {};

  // Initialize all models
  getSessionModel(ctx);
  getPeersModel(ctx);
  getSyncModel(ctx);
  getRepositoryModel(ctx);
  getActivityLogModel(ctx);
  getUserActionsModel(ctx);

  // Initialize state storage
  getPeerInstance(ctx);
  getPeerConnections(ctx);
  getGitStore(ctx);

  // Note: APIs must be injected by the test

  return ctx;
}

// Re-export controller factories
export { createMainController } from "./main-controller.js";
export { createRepositoryController, type GitStore } from "./repository-controller.js";
export { createSessionController } from "./session-controller.js";
export { createSyncController } from "./sync-controller.js";
