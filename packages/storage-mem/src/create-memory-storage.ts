/**
 * Factory function for creating in-memory storage
 */

import type { HashAlgorithm } from "@webrun-vcs/common";
import type { ObjectId } from "@webrun-vcs/storage";
import {
  DefaultObjectStorage,
  IntermediateCache,
  LRUCache,
} from "@webrun-vcs/storage-default";
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
  /**
   * Hash algorithm to use for object IDs
   * - 'SHA-256': Default, used for general content-addressable storage
   * - 'SHA-1': Use for Git compatibility
   */
  hashAlgorithm?: HashAlgorithm;
}

/**
 * Create an in-memory object storage
 *
 * Provides a complete in-memory storage implementation suitable for
 * testing, development, and short-lived storage needs.
 *
 * @param options Optional configuration
 * @returns Configured DefaultObjectStorage with in-memory repositories
 */
export function createMemoryStorage(options?: MemoryStorageOptions): DefaultObjectStorage {
  const objectRepo = new InMemoryObjectRepository();
  const deltaRepo = new InMemoryDeltaRepository();
  const metadataRepo = new InMemoryMetadataRepository();
  const contentCache = new LRUCache<ObjectId, Uint8Array>(
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
    { hashAlgorithm: options?.hashAlgorithm },
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
