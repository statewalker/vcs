import type { RawStorage } from "../../storage/raw/raw-storage.js";
import { GitObjectStoreImpl } from "./object-store.impl.js";
import type { GitObjectStore, GitObjectStoreOptions } from "./object-store.js";

export * from "./load-with-header.js";
export * from "./object-header.js";
export * from "./object-store.impl.js";
export * from "./object-store.js";
export * from "./object-types.js";

/**
 * Create a Git object store with the given storage backend
 *
 * This is the primary factory function for creating GitObjectStore instances.
 * For Git-compatible file storage, set compress: true.
 *
 * @param storage Raw storage backend for persisted objects
 * @param options Additional options (volatile store, compression)
 * @returns GitObjectStore instance
 *
 * @example
 * ```typescript
 * // Simple in-memory store
 * const store = createGitObjectStore(new MemoryRawStorage());
 *
 * // Git-compatible file store with compression
 * const store = createGitObjectStore(fileStorage, { compress: true });
 * ```
 */
export function createGitObjectStore(
  storage: RawStorage,
  options?: Omit<GitObjectStoreOptions, "storage">,
): GitObjectStore {
  return new GitObjectStoreImpl({ storage, ...options });
}
