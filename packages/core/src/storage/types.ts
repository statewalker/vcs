/**
 * Storage layer types for object and delta management
 *
 * This module defines the core types used throughout the storage system,
 * providing a foundation for content-addressable storage with delta compression.
 */

/**
 * Object identifier (SHA-256 or SHA-1 hash in hex format)
 */
export type ObjectId = string;

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
