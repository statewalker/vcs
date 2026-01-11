/**
 * Git object store interface
 *
 * Unified interface for all Git object types (blob, commit, tree, tag).
 * Git objects are stored with header: "type size\0content"
 * SHA-1 hash is computed over the full object (header + content).
 */

import type { ObjectId } from "../common/id/index.js";
import type { ObjectTypeString } from "./object-types.js";

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
 * Provides storage for all Git object types (blob, commit, tree, tag).
 * Objects are stored with Git format: "type size\0content"
 * and identified by their SHA-1 hash.
 */
export interface GitObjectStore {
  /**
   * Store object content
   *
   * Content is provided without the Git header - the header is added
   * automatically based on type and content size.
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
   * Load raw object including header
   *
   * @param id ObjectId of the object
   * @returns Async iterable of raw object chunks (with header)
   * @throws Error if object not found
   */
  loadRaw(id: ObjectId): AsyncGenerator<Uint8Array>;

  /**
   * Get object header and content stream
   * @param id ObjectId of the object
   * @returns Tuple of object header and async iterable of content chunks
   * @throws Error if object not found
   */
  loadWithHeader(id: ObjectId): Promise<[GitObjectHeader, AsyncGenerator<Uint8Array>]>;

  /**
   * Load object content (header stripped)
   *
   * @param id ObjectId of the object
   * @returns Async iterable of content chunks (without header)
   * @throws Error if object not found
   */
  load(id: ObjectId): AsyncGenerator<Uint8Array>;

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
