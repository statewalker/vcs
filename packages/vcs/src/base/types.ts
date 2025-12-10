/**
 * Repository types for storage layer
 *
 * These types are used by repository implementations for
 * content-addressable storage with delta compression.
 */

import type { ObjectId } from "../interfaces/index.js";

/**
 * Object entry stored in the repository
 *
 * Each entry has both a content hash (id) and an internal record ID for efficient
 * delta relationship tracking.
 */
export interface ObjectEntry {
  /** Internal record ID (like Fossil's rid) for efficient delta linking */
  recordId: number;
  /** SHA-256 / SHA-1 hash of the content */
  id: ObjectId;
  /** Uncompressed content size in bytes */
  size: number;
  /** Either full content (compressed) or delta bytes */
  content: Uint8Array;
  /** Creation timestamp */
  created: number;
  /** Last access timestamp for LRU tracking */
  accessed: number;
}

/**
 * Delta relationship entry
 *
 * Links an object stored as delta to its base object using record IDs
 */
export interface DeltaEntry {
  /** Record ID of the object stored as delta */
  objectRecordId: number;
  /** Record ID of the base object */
  baseRecordId: number;
  /** Size of the delta in bytes */
  deltaSize: number;
}

/**
 * Cache metadata for access tracking
 */
export interface CacheMetadata {
  /** Object ID being tracked */
  objectId: ObjectId;
  /** Last access timestamp */
  lastAccessed: number;
  /** Number of times accessed */
  accessCount: number;
  /** Size of the object in bytes */
  size: number;
}

/**
 * Repository statistics
 */
export interface RepositoryStats {
  /** Total number of objects */
  objectCount: number;
  /** Total size of all objects (compressed) */
  totalSize: number;
  /** Number of objects stored as deltas */
  deltaCount: number;
  /** Average delta chain depth */
  averageChainDepth: number;
  /** Compression ratio (compressed / uncompressed) */
  compressionRatio: number;
}
