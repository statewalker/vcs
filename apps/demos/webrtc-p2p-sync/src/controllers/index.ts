/**
 * Controllers index - exports all controllers and app context utilities.
 *
 * Uses the new Three-Part Architecture (History/Checkout/Worktree):
 * - History: Immutable repository objects (blobs, trees, commits, tags, refs)
 * - Checkout: Mutable local state (HEAD, staging, operation states)
 * - Worktree: File system access (in-memory for this demo)
 */

import { Git } from "@statewalker/vcs-commands";
import type { History, SerializationApi, WorkingCopy } from "@statewalker/vcs-core";
import {
  createMemoryHistory,
  createSimpleStaging,
  DefaultSerializationApi,
  MemoryCheckout,
  MemoryWorkingCopy,
  MemoryWorktree,
} from "@statewalker/vcs-core";

/**
 * Create SerializationApi from History facade.
 */
function createSerializationApi(history: History): SerializationApi {
  return new DefaultSerializationApi({ history });
}

import {
  createRealPeerJsApi,
  createRealTimerApi,
  setConnectionProvider,
  setPeerJsApi,
  setTimerApi,
} from "../apis/index.js";
import { getIntents } from "../intents/index.js";
import { newAdapter } from "../utils/index.js";

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
 * Context adapter for MemoryWorktree (in-memory file storage).
 * Provides access to the worktree for file operations in the demo.
 */
export const [getWorktree, setWorktree] = newAdapter<MemoryWorktree | null>("worktree", () => null);

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
 * Initialize the Git infrastructure using the new Three-Part Architecture.
 *
 * @param ctx The application context to initialize
 */
async function initializeGitInfrastructure(ctx: AppContext): Promise<void> {
  // 1. Create in-memory History (blobs, trees, commits, tags, refs)
  const history = createMemoryHistory();
  await history.initialize();

  // Set HEAD as symbolic ref in history.refs so CommitCommand updates refs/heads/main.
  // MemoryCheckout.initialHead only sets checkout-local state, not history.refs.
  await history.refs.setSymbolic("HEAD", "refs/heads/main");

  setHistory(ctx, history);

  // 2. Create in-memory Staging
  const staging = createSimpleStaging();

  // 3. Create in-memory Checkout (HEAD, operation states)
  const checkout = new MemoryCheckout({
    staging,
    initialHead: { type: "symbolic", target: "refs/heads/main" },
  });

  // 4. Create in-memory Worktree (file storage)
  const worktree = new MemoryWorktree({
    blobs: history.blobs,
    trees: history.trees,
  });
  setWorktree(ctx, worktree);

  // 5. Create WorkingCopy (combines history, checkout, worktree)
  const workingCopy = new MemoryWorkingCopy({
    history,
    checkout,
    worktree,
  });
  setWorkingCopy(ctx, workingCopy);

  // 6. Create Git porcelain API
  const git = Git.fromWorkingCopy(workingCopy);
  setGit(ctx, git);

  // 7. Create SerializationApi for pack import/export
  const serialization = createSerializationApi(history);
  setSerializationApi(ctx, serialization);
}

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

  // Initialize Git infrastructure
  await initializeGitInfrastructure(ctx);

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
// This helps other files that may still reference getRepository
export const getRepository = getHistory;
export const setRepository = setHistory;

// Re-export types for convenience
export type { WorkingCopy } from "@statewalker/vcs-core";
// Re-export connection provider adapter
export { getConnectionProvider, setConnectionProvider } from "../apis/index.js";
// Re-export intent adapters
export { getIntents, setIntents } from "../intents/index.js";
// Re-export controller factories
export { createControllers } from "./main-controller.js";
export { createRepositoryController } from "./repository-controller.js";
export { createSessionController } from "./session-controller.js";
export { createSyncController } from "./sync-controller.js";
