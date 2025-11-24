/**
 * Object storage module with delta compression
 *
 * Provides content-addressable storage with transparent delta compression,
 * following Fossil's architectural patterns.
 */

export * from "./delta-repository.js";
export * from "./inmemory-delta-repository.js";
export * from "./inmemory-metadata-repository.js";
// Implementation exports
export * from "./inmemory-object-repository.js";
export * from "./inmemory-object-store.js";
export * from "./intermediate-cache.js";
// Cache exports
export * from "./lru-cache.js";
export * from "./metadata-repository.js";
// Interface exports
export * from "./object-repository.js";
// Type exports
export * from "./types.js";

// Factory functions
import { InMemoryDeltaRepository } from "./inmemory-delta-repository.js";
import { InMemoryMetadataRepository } from "./inmemory-metadata-repository.js";
import { InMemoryObjectRepository } from "./inmemory-object-repository.js";
import { InMemoryObjectStore } from "./inmemory-object-store.js";
import { IntermediateCache } from "./intermediate-cache.js";
import { LRUCache } from "./lru-cache.js";

/**
 * Options for creating an object store
 */
export interface ObjectStoreOptions {
  /** Maximum cache size in bytes (default: 50MB) */
  maxCacheSize?: number;
  /** Maximum number of cached entries (default: 500) */
  maxCacheEntries?: number;
}

/**
 * Create an in-memory object store with default configuration
 *
 * @param options Optional configuration
 * @returns Configured InMemoryObjectStore
 */
export function createInMemoryObjectStore(options?: ObjectStoreOptions): InMemoryObjectStore {
  const objectRepo = new InMemoryObjectRepository();
  const deltaRepo = new InMemoryDeltaRepository();
  const metadataRepo = new InMemoryMetadataRepository();
  const contentCache = new LRUCache(options?.maxCacheSize, options?.maxCacheEntries);
  const intermediateCache = new IntermediateCache();

  return new InMemoryObjectStore(
    objectRepo,
    deltaRepo,
    metadataRepo,
    contentCache,
    intermediateCache,
  );
}
