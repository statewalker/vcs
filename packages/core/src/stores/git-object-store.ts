/**
 * Git object store interface
 *
 * Unified interface for all Git object types (blob, commit, tree, tag).
 * Git objects are stored with header: "type size\0content"
 * SHA-1 hash is computed over the full object (header + content).
 */

import type { ObjectId, ObjectTypeString } from "../types/index.js";

/**
 * Git object header information
 */
export interface GitObjectHeader {
  /** Object type */
  type: ObjectTypeString;
  /** Content size in bytes */
  size: number;
}

/**
 * Unified Git object storage interface
 *
 * Single implementation handles all object types (blob, commit, tree, tag).
 * The only difference between types is the header prefix string.
 * This eliminates the N×M implementation matrix (N types × M backends).
 *
 * Handles header format, SHA-1 hashing, and storage for all object types.
 * Uses TempStore internally for unknown-size content.
 */
export interface GitObjectStore {
  /**
   * Store content with unknown size
   *
   * Uses TempStore internally to buffer content and determine size
   * before computing the hash and writing the object.
   *
   * @param type Object type
   * @param content Async iterable of content chunks (without header)
   * @returns ObjectId (SHA-1 hash of header + content)
   */
  store(
    type: ObjectTypeString,
    content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): Promise<ObjectId>;

  /**
   * Load object content (header stripped)
   *
   * @param id ObjectId of the object
   * @returns Async iterable of content chunks (without header)
   * @throws Error if object not found
   */
  load(id: ObjectId): AsyncIterable<Uint8Array>;

  /**
   * Load raw object including header
   *
   * @param id ObjectId of the object
   * @returns Async iterable of raw object chunks (with header)
   * @throws Error if object not found
   */
  loadRaw(id: ObjectId): AsyncIterable<Uint8Array>;

  /**
   * Get object header without loading content
   *
   * @param id ObjectId of the object
   * @returns Object type and content size
   * @throws Error if object not found
   */
  getHeader(id: ObjectId): Promise<GitObjectHeader>;

  /**
   * Check if object exists
   *
   * @param id ObjectId of the object
   * @returns True if object exists
   */
  has(id: ObjectId): Promise<boolean>;

  /**
   * Delete object
   *
   * @param id ObjectId of the object
   * @returns True if object was deleted, false if it didn't exist
   */
  delete(id: ObjectId): Promise<boolean>;

  /**
   * List all object IDs
   *
   * @returns Async iterable of all object IDs
   */
  list(): AsyncIterable<ObjectId>;
}
