/**
 * Delta repository interface
 *
 * Manages delta relationships between objects using record IDs.
 */

import type { DeltaEntry } from "../types.js";

/**
 * Repository for managing delta relationships
 *
 * Tracks which objects are stored as deltas and their base objects,
 * using record IDs for efficiency.
 */
export interface DeltaRepository {
  /**
   * Get delta entry for an object
   *
   * @param objectRecordId Record ID of the object
   * @returns Delta entry or undefined if object is not a delta
   */
  get(objectRecordId: number): Promise<DeltaEntry | undefined>;

  /**
   * Set delta relationship
   *
   * @param entry Delta entry linking object to base
   */
  set(entry: DeltaEntry): Promise<void>;

  /**
   * Check if object is stored as delta
   *
   * @param objectRecordId Record ID of the object
   * @returns True if object is a delta
   */
  has(objectRecordId: number): Promise<boolean>;

  /**
   * Delete delta relationship
   *
   * @param objectRecordId Record ID of the object
   */
  delete(objectRecordId: number): Promise<void>;

  /**
   * Get complete delta chain from target back to base
   *
   * @param objectRecordId Record ID of the target object
   * @returns Array of delta entries ordered from target to base
   */
  getChain(objectRecordId: number): Promise<DeltaEntry[]>;

  /**
   * Get base record ID for an object
   *
   * @param objectRecordId Record ID of the object
   * @returns Base record ID or undefined if not a delta
   */
  getBaseRecordId(objectRecordId: number): Promise<number | undefined>;

  /**
   * Get all objects that depend on a base object
   *
   * @param baseRecordId Record ID of the base object
   * @returns Array of dependent object record IDs
   */
  getDependents(baseRecordId: number): Promise<number[]>;

  /**
   * Check if object has dependents
   *
   * @param baseRecordId Record ID of the base object
   * @returns True if object has dependents
   */
  hasDependents(baseRecordId: number): Promise<boolean>;

  /**
   * Get delta chain depth
   *
   * @param objectRecordId Record ID of the object
   * @returns Number of deltas in the chain
   */
  getChainDepth(objectRecordId: number): Promise<number>;

  /**
   * Check if creating a delta would create a cycle
   *
   * @param objectRecordId Record ID of the object to deltify
   * @param proposedBaseId Record ID of the proposed base
   * @returns True if this would create a cycle
   */
  wouldCreateCycle(objectRecordId: number, proposedBaseId: number): Promise<boolean>;
}
