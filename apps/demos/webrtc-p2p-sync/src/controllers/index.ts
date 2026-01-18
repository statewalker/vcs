/**
 * Controllers index - exports all controllers and app context utilities.
 */

import { createGitStore, Git, type GitStoreWithWorkTree } from "@statewalker/vcs-commands";
import type { FilesApi, HistoryStore } from "@statewalker/vcs-core";
import {
  createFileTreeIterator,
  createGitRepository,
  createInMemoryFilesApi,
  FileStagingStore,
} from "@statewalker/vcs-core";
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
 * Context adapter for FilesApi (virtual filesystem).
 */
export const [getFilesApi, setFilesApi] = newAdapter<FilesApi | null>("files-api", () => null);

/**
 * Context adapter for GitRepository (history store).
 */
export const [getRepository, setRepository] = newAdapter<HistoryStore | null>(
  "repository",
  () => null,
);

/**
 * Context adapter for GitStore with worktree.
 */
export const [getGitStore, setGitStore] = newAdapter<GitStoreWithWorkTree | null>(
  "git-store",
  () => null,
);

/**
 * Context adapter for Git porcelain API.
 */
export const [getGit, setGit] = newAdapter<Git | null>("git", () => null);

/**
 * Initialize the Git infrastructure (FilesApi, Repository, Staging, Worktree, Git).
 *
 * @param ctx The application context to initialize
 */
async function initializeGitInfrastructure(ctx: AppContext): Promise<void> {
  // 1. Create in-memory FilesApi (virtual filesystem)
  const files = createInMemoryFilesApi();
  setFilesApi(ctx, files);

  // 2. Create GitRepository (auto-initializes .git structure)
  const repository = await createGitRepository(files, ".git", {
    create: true,
    defaultBranch: "main",
  });
  setRepository(ctx, repository);

  // 3. Create staging store (Git index)
  const staging = new FileStagingStore(files, ".git/index");
  await staging.read(); // Load existing or start empty

  // 4. Create worktree iterator
  const worktree = createFileTreeIterator({
    files,
    rootPath: "",
    gitDir: ".git",
  });

  // 5. Create GitStore combining repository + staging + worktree
  const store = createGitStore({ repository, staging, worktree });
  setGitStore(ctx, store);

  // 6. Create Git porcelain API
  const git = Git.wrap(store);
  setGit(ctx, git);
}

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

  // Initialize Git infrastructure
  await initializeGitInfrastructure(ctx);

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

  // Note: Git infrastructure and APIs must be injected by the test

  return ctx;
}

// Re-export types for convenience
export type { GitStoreWithWorkTree } from "@statewalker/vcs-commands";
// Re-export controller factories
export { createMainController } from "./main-controller.js";
export { createRepositoryController } from "./repository-controller.js";
export { createSessionController } from "./session-controller.js";
export { createSyncController } from "./sync-controller.js";
