/**
 * DeltaStorage interface - Persist delta-compressed objects
 *
 * Storage abstraction for delta-compressed objects.
 * Implementations may use different backends:
 * - Git pack files (OFS_DELTA, REF_DELTA)
 * - SQL tables
 * - Key-value stores
 */

import type { ObjectId } from "../id/object-id.js";
import type { BestDeltaResult } from "./delta-engine.js";

/**
 * A stored delta record
 */
export interface DeltaRecord {
  /** Base object ID this delta is relative to */
  baseId: ObjectId;
  /** Delta bytes */
  delta: Uint8Array;
  /** Size of target when reconstructed */
  targetSize: number;
  /** Current chain depth */
  chainDepth: number;
}

/**
 * DeltaStorage interface
 *
 * Storage for delta-compressed objects.
 * Abstracts away storage format differences.
 */
export interface DeltaStorage {
  /**
   * Store a delta for a target object
   *
   * @param targetId Target object ID
   * @param delta Delta information from DeltaEngine
   */
  storeDelta(targetId: ObjectId, delta: BestDeltaResult): Promise<void>;

  /**
   * Load stored delta for a target
   *
   * @param targetId Target object ID
   * @returns Stored delta or null if not stored as delta
   */
  loadDelta(targetId: ObjectId): Promise<DeltaRecord | null>;

  /**
   * Check if object is stored as a delta
   *
   * @param targetId Target object ID
   * @returns True if stored as delta
   */
  isDelta(targetId: ObjectId): Promise<boolean>;

  /**
   * Get the delta chain depth
   *
   * @param targetId Target object ID
   * @returns Chain depth (0 = full object or not found)
   */
  getChainDepth(targetId: ObjectId): Promise<number>;

  /**
   * Resolve delta chain to get full content
   *
   * Follows the delta chain to reconstruct full object content.
   * May follow multiple levels of deltas.
   *
   * @param targetId Target object ID
   * @returns Full object content
   * @throws Error if chain is broken or exceeds max depth
   */
  resolve(targetId: ObjectId): Promise<Uint8Array>;

  /**
   * Remove delta, storing as full object
   *
   * Converts a delta-stored object back to a full object.
   * Useful when breaking delta chains or optimizing access patterns.
   *
   * @param targetId Target object ID
   */
  undelta(targetId: ObjectId): Promise<void>;

  /**
   * Get all objects that depend on a base
   *
   * Returns objects that have this base as their delta base.
   * Useful for understanding delta relationships and GC.
   *
   * @param baseId Base object ID
   * @returns Object IDs that depend on this base
   */
  getDependents(baseId: ObjectId): AsyncIterable<ObjectId>;
}

/**
 * Extended DeltaStorage with batch operations
 */
export interface BatchDeltaStorage extends DeltaStorage {
  /**
   * Store multiple deltas in a batch
   *
   * More efficient than individual storeDelta calls
   * for bulk operations like repacking.
   *
   * @param deltas Map of targetId -> delta
   */
  storeDeltaBatch(deltas: Map<ObjectId, BestDeltaResult>): Promise<void>;

  /**
   * Begin a transaction for atomic delta updates
   *
   * @returns Transaction object
   */
  beginTransaction(): Promise<DeltaStorageTransaction>;
}

/**
 * Transaction for atomic delta storage updates
 */
export interface DeltaStorageTransaction {
  /** Store a delta within the transaction */
  storeDelta(targetId: ObjectId, delta: BestDeltaResult): Promise<void>;
  /** Remove a delta within the transaction */
  undelta(targetId: ObjectId): Promise<void>;
  /** Commit all changes */
  commit(): Promise<void>;
  /** Rollback all changes */
  rollback(): Promise<void>;
}
