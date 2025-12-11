/**
 * Metadata repository interface
 *
 * Manages auxiliary data for performance optimization and analytics.
 */

import type { ObjectId } from "../../interfaces/index.js";
import type { CacheMetadata } from "../types.js";

/**
 * Repository for managing object metadata and cache hints
 *
 * Tracks access patterns and statistics without cluttering the core
 * ObjectRepository interface.
 */
export interface MetadataRepository {
  /**
   * Record an object access for LRU tracking
   *
   * @param objectId Object ID that was accessed
   */
  recordAccess(objectId: ObjectId): Promise<void>;

  /**
   * Get least recently used objects
   *
   * @param limit Maximum number of candidates to return
   * @returns Array of object IDs sorted by last access (oldest first)
   */
  getLRUCandidates(limit: number): Promise<ObjectId[]>;

  /**
   * Get total size of all tracked objects
   *
   * @returns Total size in bytes
   */
  getTotalSize(): Promise<number>;

  /**
   * Mark object as frequently accessed (hot)
   *
   * @param objectId Object ID to mark as hot
   */
  markHot(objectId: ObjectId): Promise<void>;

  /**
   * Mark object as infrequently accessed (cold)
   *
   * @param objectId Object ID to mark as cold
   */
  markCold(objectId: ObjectId): Promise<void>;

  /**
   * Get hot objects (frequently accessed)
   *
   * @param limit Maximum number to return
   * @returns Array of hot object IDs
   */
  getHotObjects(limit: number): Promise<ObjectId[]>;

  /**
   * Update size metadata for an object
   *
   * @param objectId Object ID
   * @param size Size in bytes
   */
  updateSize(objectId: ObjectId, size: number): Promise<void>;

  /**
   * Get metadata for an object
   *
   * @param objectId Object ID
   * @returns Metadata or undefined if not tracked
   */
  getMetadata(objectId: ObjectId): Promise<CacheMetadata | undefined>;
}
