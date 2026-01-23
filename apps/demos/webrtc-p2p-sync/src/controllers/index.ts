/**
 * Controllers index - exports all controllers and app context utilities.
 */

import { createGitStore, Git, type GitStoreWithWorkTree } from "@statewalker/vcs-commands";
import type { FilesApi, HistoryStore, StorageBackend } from "@statewalker/vcs-core";
import {
  createFileTreeIterator,
  createGitRepository,
  createInMemoryFilesApi,
  FileStagingStore,
} from "@statewalker/vcs-core";
import type { RepositoryAccess } from "@statewalker/vcs-transport";
import { createVcsRepositoryAccess } from "@statewalker/vcs-transport-adapters";
import type { PeerConnection, PeerInstance } from "../apis/index.js";
import {
  createRealPeerJsApi,
  createRealTimerApi,
  setPeerJsApi,
  setTimerApi,
} from "../apis/index.js";
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
 * Context adapter for StorageBackend.
 * Provides unified storage access for transport operations.
 */
export const [getStorageBackend, setStorageBackend] = newAdapter<StorageBackend | null>(
  "storage-backend",
  () => null,
);

/**
 * Context adapter for RepositoryAccess.
 * Used by Git protocol handlers for transport operations.
 */
export const [getRepositoryAccess, setRepositoryAccess] = newAdapter<RepositoryAccess | null>(
  "repository-access",
  () => null,
);

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

  // 3. Set up StorageBackend and RepositoryAccess for transport
  const backend = repository.backend;
  if (backend) {
    setStorageBackend(ctx, backend);
    // Create RepositoryAccess from the structured stores
    const repositoryAccess = createVcsRepositoryAccess(backend.structured);
    setRepositoryAccess(ctx, repositoryAccess);
  }

  // 4. Create staging store (Git index)
  const staging = new FileStagingStore(files, ".git/index");
  await staging.read(); // Load existing or start empty

  // 5. Create worktree iterator
  const worktree = createFileTreeIterator({
    files,
    rootPath: "",
    gitDir: ".git",
  });

  // 6. Create GitStore combining repository + staging + worktree
  const store = createGitStore({ repository, staging, worktree, files, workTreeRoot: "" });
  setGitStore(ctx, store);

  // 7. Create Git porcelain API
  const git = Git.wrap(store);
  setGit(ctx, git);
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
 * Models are lazy-created by adapters when first accessed.
 *
 * @returns Test context (without real APIs - you must inject mocks)
 */
export function createTestContext(): AppContext {
  const ctx: AppContext = {};

  // Initialize state storage for peer connections
  getPeerInstance(ctx);
  getPeerConnections(ctx);

  // Note: Git infrastructure and APIs must be injected by the test

  return ctx;
}

// Re-export types for convenience
export type { GitStoreWithWorkTree } from "@statewalker/vcs-commands";
// Re-export controller factories
export { createControllers } from "./main-controller.js";
export { createRepositoryController } from "./repository-controller.js";
export { createSessionController } from "./session-controller.js";
export { createSyncController } from "./sync-controller.js";
