import { DefaultObjectStorage } from "../storage-impl/default-object-storage.js";
import { IntermediateCache } from "./intermediate-cache.js";
import { LRUCache } from "./lru-cache.js";
import { InMemoryDeltaRepository } from "./mem/delta-repository.js";
import { InMemoryMetadataRepository } from "./mem/metadata-repository.js";
import { InMemoryObjectRepository } from "./mem/object-repository.js";

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
 * Create a default object storage with in-memory repositories
 *
 * @param options Optional configuration
 * @returns Configured DefaultObjectStorage
 */
export function createDefaultObjectStorage(options?: ObjectStoreOptions): DefaultObjectStorage {
  const objectRepo = new InMemoryObjectRepository();
  const deltaRepo = new InMemoryDeltaRepository();
  const metadataRepo = new InMemoryMetadataRepository();
  const contentCache = new LRUCache<string, Uint8Array>(
    options?.maxCacheSize,
    options?.maxCacheEntries,
  );
  const intermediateCache = new IntermediateCache();

  return new DefaultObjectStorage(
    objectRepo,
    deltaRepo,
    metadataRepo,
    contentCache,
    intermediateCache,
  );
}
