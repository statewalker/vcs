import type { ObjectStore } from "./object-store.js";
import type { ObjectId } from "./types.js";

/**
 * Options for delta creation
 */
export interface DeltaOptions {
  /** Minimum size for deltification (default: 50 bytes) */
  minSize?: number;
  /** Minimum compression ratio to accept delta (default: 0.75 = 25% savings) */
  minCompressionRatio?: number;
  /** Maximum delta chain depth (default: 50, matching JGit) */
  maxChainDepth?: number;
  /** Enforce privacy boundaries (prevent cross-privacy deltas) */
  enforcePrivacy?: boolean;
}

/**
 * Delta chain information
 */
export interface DeltaChainInfo {
  /** ObjectId of the base (non-delta) object */
  baseId: ObjectId;
  /** Chain depth (0 = full object, 1+ = delta depth) */
  depth: number;
  /** Total size savings (original - current compressed) */
  savings: number;
}

/**
 * Delta-aware object storage interface
 *
 * Extends ObjectStore with delta compression capabilities.
 * This interface exposes delta operations that implementations
 * may use for storage optimization.
 *
 * The basic ObjectStore methods (store, load, getSize, has, delete) work
 * transparently - callers don't need to know if content is stored
 * as full objects or deltas.
 *
 * Implementation notes (JGit/Fossil patterns):
 * - Minimum 50-byte size threshold for deltification
 * - 75% compression ratio requirement (25% savings minimum)
 * - Maximum chain depth of 50 (JGit default)
 * - Intermediate caching every 8 steps in chain (Fossil pattern)
 * - Cycle prevention in delta chains
 */
export interface DeltaObjectStore extends ObjectStore {
  /**
   * Deltify object against candidate bases
   *
   * Attempts to store the target object as a delta against one
   * of the candidate objects. The best candidate (smallest delta)
   * is chosen if it meets compression requirements.
   *
   * @param targetId Object to deltify
   * @param candidateIds Potential base objects
   * @param options Delta creation options
   * @returns True if object was successfully deltified
   */
  deltify(targetId: ObjectId, candidateIds: ObjectId[], options?: DeltaOptions): Promise<boolean>;

  /**
   * Convert delta storage back to full content
   *
   * Useful when the base object needs to be deleted or when
   * we want to break a long delta chain.
   *
   * @param id Object to undeltify
   */
  undeltify(id: ObjectId): Promise<void>;

  /**
   * Get delta chain information for an object
   *
   * @param id Object to query
   * @returns Chain info or undefined if not stored as delta
   */
  getDeltaChainInfo(id: ObjectId): Promise<DeltaChainInfo | undefined>;

  /**
   * Check if object is stored as delta
   *
   * @param id Object to check
   * @returns True if object is stored as delta
   */
  isDelta(id: ObjectId): Promise<boolean>;

  /**
   * Optimize delta chains
   *
   * Reorganizes delta chains for better access patterns.
   * May undeltify some objects, re-deltify others.
   *
   * @param options Optimization options
   */
  optimizeDeltaChains?(options?: {
    /** Maximum chain depth to allow */
    maxDepth?: number;
    /** Target compression ratio */
    targetRatio?: number;
  }): Promise<void>;
}
