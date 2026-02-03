/**
 * Storage backend factory
 *
 * Creates StorageBackend and HistoryWithOperations instances.
 *
 * ## New Pattern (Recommended)
 *
 * Use HistoryWithOperations factories for new code:
 * - `createHistory()` - Create HistoryWithOperations from registered backend type
 * - `createMemoryHistoryWithOperations()` - In-memory with full operations
 * - `createGitFilesHistory()` - Git-files backed with full operations
 *
 * ## Legacy Pattern (Deprecated)
 *
 * The StorageBackend-based factories are deprecated:
 * - `createStorageBackend()` - Use `createHistory()` instead
 * - `registerBackendFactory()` - Use `registerHistoryBackendFactory()` instead
 */

import type { BackendConfig, BackendType, StorageBackend } from "./storage-backend.js";

export type {
  BaseBackendConfig,
  GitFilesBackendConfig,
  HistoryBackendFactory,
  HistoryBackendType,
  MemoryBackendConfig,
  SQLBackendConfig,
} from "./history-backend-factory.js";
// Re-export the new HistoryBackendFactory pattern
export {
  createHistory,
  getRegisteredHistoryBackendTypes,
  hasHistoryBackendFactory,
  registerHistoryBackendFactory,
} from "./history-backend-factory.js";

/**
 * Registry of backend factories
 *
 * Maps backend types to their factory functions.
 * New backends can be registered at runtime.
 *
 * @deprecated Use `registerHistoryBackendFactory()` instead.
 * The new pattern returns HistoryWithOperations directly.
 */
const backendFactories = new Map<BackendType, (config: BackendConfig) => Promise<StorageBackend>>();

/**
 * Create a storage backend
 *
 * Factory function for creating StorageBackend instances.
 * The backend is NOT initialized - call initialize() before use.
 *
 * @deprecated Use `createHistory()` or `createHistoryWithOperations()` instead.
 * The new pattern returns HistoryWithOperations directly, providing unified
 * access to typed stores and storage operations.
 *
 * Migration:
 * ```typescript
 * // Old pattern (deprecated)
 * const backend = await createStorageBackend("git-files", { path: ".git" });
 * const history = createHistoryWithOperations({ backend });
 *
 * // New pattern (recommended)
 * const history = await createHistory("git-files", { path: ".git" });
 * // OR for specific backends:
 * const history = createGitFilesHistory(stores);
 * const history = createMemoryHistoryWithOperations();
 * ```
 *
 * @param type Backend type: "git-files" | "sql" | "kv" | "memory"
 * @param config Backend-specific configuration
 * @returns StorageBackend instance (not yet initialized)
 * @throws Error if backend type is not registered
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
 * @deprecated Use `registerHistoryBackendFactory()` instead.
 * The new pattern registers factories that return HistoryWithOperations.
 *
 * Migration:
 * ```typescript
 * // Old pattern (deprecated)
 * registerBackendFactory("custom", async (config) => {
 *   return new CustomStorageBackend(config);
 * });
 *
 * // New pattern (recommended)
 * registerHistoryBackendFactory("custom", async (config) => {
 *   const backend = new CustomStorageBackend(config);
 *   return createHistoryWithOperations({ backend });
 * });
 * ```
 *
 * @param type Backend type identifier
 * @param factory Factory function that creates the backend
 */
export function registerBackendFactory(
  type: BackendType,
  factory: (config: BackendConfig) => Promise<StorageBackend>,
): void {
  backendFactories.set(type, factory);
}

/**
 * Check if a backend type is registered
 *
 * @deprecated Use `hasHistoryBackendFactory()` instead.
 */
export function hasBackendFactory(type: BackendType): boolean {
  return backendFactories.has(type);
}

/**
 * Get all registered backend types
 *
 * @deprecated Use `getRegisteredHistoryBackendTypes()` instead.
 */
export function getRegisteredBackendTypes(): BackendType[] {
  return [...backendFactories.keys()];
}
