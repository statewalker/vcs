/**
 * Controllers index - exports all controllers and app context utilities.
 *
 * Uses the Three-Part Architecture (History/Checkout/Worktree):
 * - History: Immutable repository objects (blobs, trees, commits, tags, refs)
 * - Checkout: Mutable local state (HEAD, staging, operation states)
 * - Worktree: File system access (in-memory or file-backed)
 */

import type { Git } from "@statewalker/vcs-commands";
import type { History, SerializationApi, WorkingCopy, Worktree } from "@statewalker/vcs-core";

import {
  createRealPeerJsApi,
  createRealTimerApi,
  setConnectionProvider,
  setPeerJsApi,
  setTimerApi,
} from "../apis/index.js";
import { getIntents } from "../intents/index.js";
import { newAdapter } from "../utils/index.js";
import { initializeGitInMemory } from "./git-infrastructure.js";

/**
 * Application context type.
 * A simple record that holds all models, APIs, and shared state.
 */
export type AppContext = Record<string, unknown>;

/**
 * Context adapter for active peer connections (MessagePort per peer).
 */
export const [getPeerConnections, setPeerConnections] = newAdapter<Map<string, MessagePort>>(
  "peer-connections",
  () => new Map(),
);

/**
 * Context adapter for History (immutable repository objects).
 */
export const [getHistory, setHistory] = newAdapter<History | null>("history", () => null);

/**
 * Context adapter for WorkingCopy (unified repository + checkout + worktree).
 */
export const [getWorkingCopy, setWorkingCopy] = newAdapter<WorkingCopy | null>(
  "working-copy",
  () => null,
);

/**
 * Context adapter for Worktree (file storage — in-memory or file-backed).
 */
export const [getWorktree, setWorktree] = newAdapter<Worktree | null>("worktree", () => null);

/**
 * Context adapter for Git porcelain API.
 */
export const [getGit, setGit] = newAdapter<Git | null>("git", () => null);

/**
 * Context adapter for SerializationApi.
 * Used for pack import/export operations.
 */
export const [getSerializationApi, setSerializationApi] = newAdapter<SerializationApi | null>(
  "serialization-api",
  () => null,
);

/**
 * Context adapter for storage mode label (e.g. "In-Memory" or "/projects/my-app").
 */
export const [getStorageLabel, setStorageLabel] = newAdapter<string>(
  "storage-label",
  () => "In-Memory",
);

/**
 * Create and initialize the application context.
 *
 * This sets up APIs and Git infrastructure used by controllers.
 * Models are lazy-created by adapters when first accessed.
 *
 * @returns Initialized application context
 */
export async function createAppContext(): Promise<AppContext> {
  const ctx: AppContext = {};

  // Initialize state storage for peer connections
  getPeerConnections(ctx);

  // Initialize intent dispatcher
  getIntents(ctx);

  // Initialize Git infrastructure (in-memory by default)
  await initializeGitInMemory(ctx);

  // Inject real API implementations
  const peerJsApi = await createRealPeerJsApi();
  setPeerJsApi(ctx, peerJsApi);
  setTimerApi(ctx, createRealTimerApi());

  // Create PeerJS-backed connection provider
  const { PeerJsConnectionProvider } = await import("../apis/peerjs-connection-provider.js");
  setConnectionProvider(ctx, new PeerJsConnectionProvider(peerJsApi));

  return ctx;
}

/**
 * Create a test context with mock APIs.
 *
 * Use this in unit tests to inject mock implementations.
 * Models are lazy-created by adapters when first accessed.
 *
 * @returns Test context (without real APIs - you must inject mocks)
 */
export function createTestContext(): AppContext {
  const ctx: AppContext = {};

  // Initialize state storage for peer connections
  getPeerConnections(ctx);

  // Note: Git infrastructure and APIs must be injected by the test

  return ctx;
}

// Legacy compatibility - re-export getRepository as alias for getHistory
export const getRepository = getHistory;
export const setRepository = setHistory;

// Re-export types for convenience
export type { WorkingCopy } from "@statewalker/vcs-core";
// Re-export connection provider adapter
export { getConnectionProvider, setConnectionProvider } from "../apis/index.js";
// Re-export intent adapters
export { getIntents, setIntents } from "../intents/index.js";
// Re-export git infrastructure functions
export { initializeGitFromFiles, initializeGitInMemory } from "./git-infrastructure.js";
// Re-export controller factories
export { createControllers } from "./main-controller.js";
export { createRepositoryController } from "./repository-controller.js";
export { createSessionController } from "./session-controller.js";
export { createSyncController } from "./sync-controller.js";
