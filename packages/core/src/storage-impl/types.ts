/**
 * Storage layer types for object and delta management
 *
 * This module defines the core types used throughout the storage system,
 * providing a foundation for content-addressable storage with delta compression.
 */

import type { ObjectId } from "../storage/types.js";

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
 * Options for delta creation
 */
export interface DeltaOptions {
  /** Enforce privacy boundaries (prevent cross-privacy deltas) */
  enforcePrivacy?: boolean;
  /** Minimum compression ratio (default: 0.75 for 25% savings) */
  minCompressionRatio?: number;
  /** Minimum size for deltification (default: 50 bytes) */
  minSize?: number;
}

/**
 * Candidate options for multi-candidate deltification
 */
export interface CandidateOptions {
  /** Previous version of the same file */
  previousVersion?: ObjectId;
  /** Parent branch version */
  parentBranch?: ObjectId;
  /** Similar files by name or content */
  similarFiles?: ObjectId[];
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
