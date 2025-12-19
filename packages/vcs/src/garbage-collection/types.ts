/**
 * Garbage collection types
 *
 * Types for GC operations, storage analysis, and packing.
 */

import type { DeltaStorageImpl } from "../delta-compression/delta-storage-impl.js";
import type { CommitStore, TagStore, TreeStore } from "../interfaces/index.js";
import type { ObjectId } from "../interfaces/types.js";

/**
 * Context aggregating all storages required for packing operations
 */
export interface PackingContext {
  /** Delta storage implementation (provides object access and delta operations) */
  objects: DeltaStorageImpl;
  /** Tree storage for path-based candidate selection */
  trees: TreeStore;
  /** Commit storage for version-based traversal */
  commits: CommitStore;
  /** Tag storage (optional, rarely needed for packing) */
  tags?: TagStore;
}

/**
 * Information about a candidate object for packing
 */
export interface PackingCandidate {
  /** Object ID of the candidate */
  objectId: ObjectId;
  /** Object type (blob or tree) */
  objectType: "blob" | "tree";
  /** Path where object appears (available when discovered through tree walking) */
  path?: string;
  /** Object size in bytes */
  size: number;
  /** Current delta chain depth (0 = full object) */
  currentDepth: number;
  /** Estimated delta size (if computed) */
  estimatedDeltaSize?: number;
  /** Suggested base objects for deltification */
  suggestedBases: ObjectId[];
}

/**
 * Storage analysis report
 */
export interface StorageAnalysisReport {
  /** Total number of objects in storage */
  totalObjects: number;
  /** Number of full (non-delta) objects */
  fullObjects: number;
  /** Number of delta objects */
  deltaObjects: number;
  /** Average delta chain depth */
  averageChainDepth: number;
  /** Maximum delta chain depth found */
  maxChainDepth: number;
  /** Total storage size in bytes */
  totalStorageSize: number;
  /** Estimated potential savings from packing */
  estimatedSavings: number;
  /** Objects identified as candidates for packing */
  packingCandidates: PackingCandidate[];
  /** Objects not reachable from any commit (full scan only) */
  orphanedObjects?: ObjectId[];
}

/**
 * Options for packing operations
 */
export interface PackingOptions {
  /** Number of candidates to consider in sliding window (default: 10) */
  windowSize?: number;
  /** Maximum delta chain depth allowed (default: 50) */
  maxChainDepth?: number;
  /** Minimum object size for deltification in bytes (default: 50) */
  minObjectSize?: number;
  /** Minimum compression ratio required to accept delta (default: 0.75) */
  minCompressionRatio?: number;
  /** Analyze without applying changes */
  dryRun?: boolean;
  /** Progress callback for monitoring long operations */
  progressCallback?: (progress: PackingProgress) => void;
  /** Cancellation signal */
  signal?: AbortSignal;
}

/**
 * Progress information during packing
 */
export interface PackingProgress {
  /** Current phase of packing */
  phase: "analyzing" | "selecting" | "deltifying" | "optimizing" | "complete";
  /** Total objects to process */
  totalObjects: number;
  /** Objects processed so far */
  processedObjects: number;
  /** Objects successfully deltified */
  deltifiedObjects: number;
  /** Current object being processed */
  currentObjectId?: ObjectId;
  /** Bytes saved so far */
  bytesSaved: number;
}

/**
 * Result of a packing operation
 */
export interface PackingResult {
  /** Total objects analyzed */
  objectsAnalyzed: number;
  /** Objects that were deltified */
  objectsDeltified: number;
  /** Total bytes saved */
  bytesSaved: number;
  /** Average compression ratio achieved */
  averageCompressionRatio: number;
  /** Distribution of chain depths (depth -> count) */
  chainDepthDistribution: Map<number, number>;
  /** Time taken in milliseconds */
  durationMs: number;
}

/**
 * GC scheduling options
 */
export interface GCScheduleOptions {
  /** Trigger GC when loose objects exceed this count */
  looseObjectThreshold?: number;
  /** Trigger GC when delta chains exceed this depth */
  chainDepthThreshold?: number;
  /** Minimum interval between GC runs (ms) */
  minInterval?: number;
  /** Number of pending commits before quick pack */
  quickPackThreshold?: number;
}

/**
 * GC result
 */
export interface GCResult {
  /** Number of objects removed */
  objectsRemoved: number;
  /** Bytes freed */
  bytesFreed: number;
  /** Duration in ms */
  durationMs: number;
}

/**
 * Repack options (extended from PackingOptions)
 */
export interface RepackOptions extends PackingOptions {
  /** Prune loose objects after packing */
  pruneLoose?: boolean;
  /** Only pack objects reachable from this commit */
  commitScope?: ObjectId;
}

/**
 * Repack result
 */
export interface RepackResult {
  objectsProcessed: number;
  deltasCreated: number;
  deltasRemoved: number;
  looseObjectsPruned: number;
  spaceSaved: number;
  duration: number;
}

/**
 * Options for storage analysis
 */
export interface AnalyzerOptions {
  /** Minimum object size to consider for packing (default: 50) */
  minSize?: number;
  /** Maximum number of candidates to collect */
  maxCandidates?: number;
  /** Progress callback */
  onProgress?: (processed: number, total: number) => void;
  /** Cancellation signal */
  signal?: AbortSignal;
}
