/**
 * Delta compression types and strategy interfaces
 */

import type { ObjectId } from "@webrun-vcs/core";
import type { Delta } from "@webrun-vcs/utils";

/**
 * Object storage interface for strategies
 *
 * Minimal interface that strategies need for finding candidates.
 */
export interface ObjectStorage {
  /** Check if object exists */
  has(id: ObjectId): Promise<boolean>;
  /** Get object size */
  getSize(id: ObjectId): Promise<number>;
  /** List all objects */
  listObjects(): AsyncGenerator<ObjectId>;
  /** Load object content */
  load(id: ObjectId): AsyncGenerator<Uint8Array>;
}

/**
 * Delta computation options
 */
export interface DeltaComputeOptions {
  /** Maximum compression ratio to accept (e.g., 0.75 = 25% savings minimum) */
  maxRatio?: number;
  /** Minimum size for deltification */
  minSize?: number;
}

/**
 * Delta computation result
 */
export interface DeltaComputeResult {
  /** Delta instructions */
  delta: Delta[];
  /** Compression ratio (delta size / original size) */
  ratio: number;
}

/**
 * Strategy for finding delta base candidates
 *
 * Implementations scan storage to find objects that might be good
 * delta bases for a target object.
 */
export interface DeltaCandidateStrategy {
  /**
   * Find candidate base objects for deltification
   *
   * @param targetId Object to find bases for
   * @param storage Object storage to search
   * @returns Async iterable of candidate object IDs
   */
  findCandidates(targetId: ObjectId, storage: ObjectStorage): AsyncIterable<ObjectId>;
}

/**
 * Strategy for computing deltas
 *
 * Implementations compute delta instructions between two objects.
 */
export interface DeltaComputeStrategy {
  /**
   * Compute delta from base to target
   *
   * @param base Base object content
   * @param target Target object content
   * @param options Computation options
   * @returns Delta result or undefined if not beneficial
   */
  computeDelta(
    base: Uint8Array,
    target: Uint8Array,
    options?: DeltaComputeOptions,
  ): DeltaComputeResult | undefined;
}
