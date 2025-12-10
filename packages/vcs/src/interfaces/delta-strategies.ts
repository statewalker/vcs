import type { Delta } from "@webrun-vcs/utils";
import type { ObjectStore } from "./object-store.js";
import type { ObjectId } from "./types.js";

/**
 * Options for delta computation
 */
export interface DeltaComputeOptions {
  /** Minimum object size to consider for deltification (default: 50) */
  minSize?: number;
  /** Maximum compression ratio to accept (default: 0.75 = 25% savings) */
  maxRatio?: number;
  /** Maximum delta chain depth (default: 50) */
  maxChainDepth?: number;
}

/**
 * Result of delta computation
 */
export interface DeltaComputeResult {
  /** The computed delta instructions */
  delta: Delta[];
  /** Compression ratio (estimated delta size / target size) */
  ratio: number;
  /** Size of the target object */
  targetSize: number;
  /** Size of the base object */
  baseSize: number;
}

/**
 * Context for candidate search
 *
 * Note: No objectType field - delta computation is type-agnostic.
 * Object type is a Git/VCS concept, not a delta storage concern.
 */
export interface CandidateContext {
  /** Current delta chain depth of target */
  currentDepth?: number;
  /** File path hint (for path-based strategies) */
  pathHint?: string;
  /** Maximum candidates to return */
  limit?: number;
  /** Commit ID context (for commit-window strategies) */
  commitId?: ObjectId;
}

/**
 * Strategy for finding delta base candidates
 *
 * Implementations may use various heuristics:
 * - Similar file size
 * - Same file path across commits
 * - Recent objects in same commit
 * - Object type matching
 */
export interface DeltaCandidateStrategy {
  /**
   * Unique identifier for this strategy
   */
  readonly name: string;

  /**
   * Find candidate base objects for deltification
   *
   * @param targetId Object to find bases for
   * @param storage Storage to query for candidates
   * @param context Optional context (current chain depth, object type, etc.)
   * @returns Async iterable of candidate object IDs, ordered by preference
   */
  findCandidates(
    targetId: ObjectId,
    storage: ObjectStore,
    context?: CandidateContext,
  ): AsyncIterable<ObjectId>;
}

/**
 * Strategy for computing deltas between objects
 *
 * Different algorithms may be used:
 * - Git's delta algorithm (rolling hash + sliding window)
 * - Fossil's delta format
 * - xdelta, etc.
 *
 * All strategies produce format-agnostic Delta[] instructions.
 * Serialization to specific formats is handled by backends.
 */
export interface DeltaComputeStrategy {
  /**
   * Unique identifier for this strategy
   */
  readonly name: string;

  /**
   * Compute delta from base to target
   *
   * @param base Source/base object content
   * @param target Target object content
   * @param options Computation options
   * @returns Delta result or null if delta isn't beneficial
   */
  computeDelta(
    base: Uint8Array,
    target: Uint8Array,
    options?: DeltaComputeOptions,
  ): DeltaComputeResult | null;

  /**
   * Apply delta to base to reconstruct target
   *
   * Uses the existing applyDelta from @webrun-vcs/diff internally.
   *
   * @param base Source/base object content
   * @param delta Delta instructions
   * @returns Reconstructed target content
   */
  applyDelta(base: Uint8Array, delta: Iterable<Delta>): Uint8Array;

  /**
   * Estimate serialized size of delta instructions
   *
   * Used to calculate compression ratio before serialization.
   *
   * @param delta Delta instructions
   * @returns Estimated byte size when serialized
   */
  estimateSize(delta: Iterable<Delta>): number;
}
