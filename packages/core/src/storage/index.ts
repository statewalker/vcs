/**
 * Storage layer types
 *
 * This module defines the core public types used throughout the storage system.
 */

/**
 * Object identifier (SHA-256 or SHA-1 hash in hex format)
 */
export type ObjectId = string;

/**
 * Object storage interface
 *
 * Provides content-addressable storage with streaming support.
 */
export interface ObjectStorage {
  /**
   * Load object content by ID
   *
   * @param id Object ID (SHA-256 hash)
   * @returns Async iterable of content chunks
   */
  load(id: ObjectId): AsyncIterable<Uint8Array>;

  /**
   * Store object content
   *
   * @param data Async iterable of content chunks
   * @returns Object ID (SHA-256 hash)
   */
  store(data: AsyncIterable<Uint8Array>): Promise<ObjectId>;

  /**
   * Check if object exists
   *
   * @param id Object ID
   * @returns True if object exists
   */
  has(id: ObjectId): Promise<boolean>;

  /**
   * Delete object
   *
   * @param id Object ID
   * @returns True if object was deleted
   */
  delete(id: ObjectId): Promise<boolean>;
}
