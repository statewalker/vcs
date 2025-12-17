/**
 * Factory function for creating in-memory storage
 */

import type { ObjectId } from "@webrun-vcs/vcs";
import { DefaultObjectStore, IntermediateCache, LRUCache } from "@webrun-vcs/vcs";
import { InMemoryDeltaRepository } from "./delta-repository.js";
import { InMemoryMetadataRepository } from "./metadata-repository.js";
import { InMemoryObjectRepository } from "./object-repository.js";

/**
 * Options for creating an in-memory object store
 */
export interface MemoryStorageOptions {
  /** Maximum cache size in bytes (default: 50MB) */
  maxCacheSize?: number;
  /** Maximum number of cached entries (default: 500) */
  maxCacheEntries?: number;
}

/**
 * Create an in-memory object storage
 *
 * Provides a complete in-memory storage implementation suitable for
 * testing, development, and short-lived storage needs.
 *
 * @param options Optional configuration
 * @returns Configured DefaultObjectStore with in-memory repositories
 */
export function createMemoryStorage(options?: MemoryStorageOptions): DefaultObjectStore {
  const objectRepo = new InMemoryObjectRepository();
  const deltaRepo = new InMemoryDeltaRepository();
  const metadataRepo = new InMemoryMetadataRepository();
  const contentCache = new LRUCache<ObjectId, Uint8Array>(
    options?.maxCacheSize,
    options?.maxCacheEntries,
  );
  const intermediateCache = new IntermediateCache();

  return new DefaultObjectStore(
    objectRepo,
    deltaRepo,
    metadataRepo,
    contentCache,
    intermediateCache,
  );
}

/**
 * Alias for backward compatibility
 * @deprecated Use createMemoryStorage instead
 */
export const createDefaultObjectStorage = createMemoryStorage;

/**
 * Alias for backward compatibility
 */
export type ObjectStoreOptions = MemoryStorageOptions;
