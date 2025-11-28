/**
 * Object repository interface and types
 *
 * Manages object entries with Fossil-style record IDs for efficient delta linking.
 */

import type { ObjectId } from "../storage/index.js";

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
 * Repository for storing and retrieving object entries
 *
 * Objects are stored with both a content hash (ObjectId) and an internal
 * record ID for efficient delta relationship tracking.
 */
export interface ObjectRepository {
  /**
   * Store an object and get back the entry with assigned recordId
   *
   * @param entry Object entry without recordId (will be assigned)
   * @returns Complete object entry with recordId
   */
  storeObject(entry: Omit<ObjectEntry, "recordId">): Promise<ObjectEntry>;

  /**
   * Load object entry by object ID
   *
   * @param objectId Object hash
   * @returns Object entry or undefined if not found
   */
  loadObjectEntry(objectId: ObjectId): Promise<ObjectEntry | undefined>;

  /**
   * Load object entry by record ID
   *
   * @param recordId Internal record ID
   * @returns Object entry or undefined if not found
   */
  loadObjectByRecordId(recordId: number): Promise<ObjectEntry | undefined>;

  /**
   * Load object content by record ID
   *
   * @param recordId Internal record ID
   * @returns Object content or undefined if not found
   */
  loadObjectContent(recordId: number): Promise<Uint8Array | undefined>;

  /**
   * Delete object by object ID
   *
   * @param objectId Object hash
   * @returns True if deleted, false if not found
   */
  deleteObject(objectId: ObjectId): Promise<boolean>;

  /**
   * Check if object exists
   *
   * @param objectId Object hash
   * @returns True if object exists
   */
  hasObject(objectId: ObjectId): Promise<boolean>;

  /**
   * Get multiple objects by their IDs
   *
   * @param objectIds Array of object IDs
   * @returns Array of found object entries
   */
  getMany(objectIds: ObjectId[]): Promise<ObjectEntry[]>;

  /**
   * Get total number of objects
   *
   * @returns Number of objects in repository
   */
  size(): Promise<number>;

  /**
   * Get all object IDs
   *
   * @returns Array of all object IDs
   */
  getAllIds(): Promise<ObjectId[]>;
}
