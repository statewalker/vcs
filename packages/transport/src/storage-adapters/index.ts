/**
 * Storage adapters for transport protocol handlers.
 *
 * Provides adapters to connect various storage implementations
 * to the RepositoryAccess interface used by protocol handlers.
 *
 * Available adapters:
 * - createRepositoryAdapter: For Repository interface from @statewalker/vcs-core
 * - createVcsRepositoryAdapter: For VcsStores (GitObjectStore, RefStore, etc.)
 * - createStorageAdapter: For MinimalStorage (legacy, Git-specific)
 */

export * from "./repository-adapter.js";
export * from "./storage-adapter.js";
export * from "./vcs-repository-adapter.js";
