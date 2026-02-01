/**
 * Storage backend factory
 *
 * Creates StorageBackend instances based on type and configuration.
 */

import type { BackendConfig, BackendType, StorageBackend } from "./storage-backend.js";

/**
 * Registry of backend factories
 *
 * Maps backend types to their factory functions.
 * New backends can be registered at runtime.
 */
const backendFactories = new Map<BackendType, (config: BackendConfig) => Promise<StorageBackend>>();

/**
 * Create a storage backend
 *
 * Factory function for creating StorageBackend instances.
 * The backend is NOT initialized - call initialize() before use.
 *
 * @param type Backend type: "git-files" | "sql" | "kv" | "memory"
 * @param config Backend-specific configuration
 * @returns StorageBackend instance (not yet initialized)
 * @throws Error if backend type is not registered
 *
 * @example
 * ```typescript
 * const backend = await createStorageBackend("git-files", { path: ".git" });
 * await backend.initialize();
 *
 * // Use the backend...
 * const commit = await backend.commits.loadCommit(commitId);
 *
 * await backend.close();
 * ```
 */
export async function createStorageBackend(
  type: BackendType,
  config: BackendConfig,
): Promise<StorageBackend> {
  const factory = backendFactories.get(type);
  if (!factory) {
    throw new Error(
      `Unknown backend type: ${type}. ` +
        `Available types: ${[...backendFactories.keys()].join(", ") || "(none registered)"}`,
    );
  }
  return factory(config);
}

/**
 * Register a backend factory
 *
 * Allows adding custom backend types at runtime.
 *
 * @param type Backend type identifier
 * @param factory Factory function that creates the backend
 *
 * @example
 * ```typescript
 * registerBackendFactory("custom", async (config) => {
 *   return new CustomStorageBackend(config);
 * });
 * ```
 */
export function registerBackendFactory(
  type: BackendType,
  factory: (config: BackendConfig) => Promise<StorageBackend>,
): void {
  backendFactories.set(type, factory);
}

/**
 * Check if a backend type is registered
 */
export function hasBackendFactory(type: BackendType): boolean {
  return backendFactories.has(type);
}

/**
 * Get all registered backend types
 */
export function getRegisteredBackendTypes(): BackendType[] {
  return [...backendFactories.keys()];
}
