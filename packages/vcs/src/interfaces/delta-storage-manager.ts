import type {
  DeltaChainDetails,
  DeltaChainStore,
  DeltaChainStoreStats,
} from "./delta-chain-store.js";
import type {
  DeltaCandidateStrategy,
  DeltaComputeOptions,
  DeltaComputeStrategy,
} from "./delta-strategies.js";
import type { ObjectStore } from "./object-store.js";
import type { ObjectId } from "./types.js";

/**
 * Repository analysis results
 */
export interface RepositoryAnalysis {
  /** Total objects in repository */
  totalObjects: number;
  /** Objects stored as loose */
  looseObjects: number;
  /** Objects stored as deltas */
  deltaObjects: number;
  /** Total uncompressed size */
  totalSize: number;
  /** Current compressed size */
  compressedSize: number;
  /** Potential additional savings from deltification */
  potentialSavings: number;
  /** Objects that could be deltified */
  deltifiableCandidates: number;
  /** Current average chain depth */
  averageChainDepth: number;
  /** Chains exceeding recommended depth */
  deepChains: number;
}

/**
 * Packing suggestion from analysis
 */
export interface PackingSuggestion {
  /** Objects to consider for deltification */
  candidates: Array<{
    targetId: ObjectId;
    suggestedBases: ObjectId[];
    estimatedRatio: number;
  }>;
  /** Estimated space savings */
  estimatedSavings: number;
  /** Chains that should be broken (too deep) */
  chainsToBreak: ObjectId[];
}

/**
 * Repack options
 */
export interface RepackOptions {
  /** Maximum delta chain depth */
  maxChainDepth?: number;
  /** Sliding window size for candidate selection */
  windowSize?: number;
  /** Use aggressive compression (slower but better) */
  aggressive?: boolean;
  /** Prune loose objects after packing */
  pruneLoose?: boolean;
  /** Only pack objects reachable from this commit */
  commitScope?: ObjectId;
  /** Progress callback */
  onProgress?: (phase: string, current: number, total: number) => void;
}

/**
 * Repack results
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
 * Main delta storage interface (facade)
 *
 * Coordinates loose object storage, delta backend, and strategies
 * to provide unified delta-aware storage.
 */
export interface DeltaStorageManager extends ObjectStore {
  /**
   * The underlying loose object storage
   */
  readonly looseStorage: ObjectStore;

  /**
   * The delta backend
   */
  readonly deltaBackend: DeltaChainStore;

  // ========== Configuration ==========

  /**
   * Set the candidate selection strategy
   */
  setCandidateStrategy(strategy: DeltaCandidateStrategy): void;

  /**
   * Set the delta computation strategy
   */
  setComputeStrategy(strategy: DeltaComputeStrategy): void;

  /**
   * Get current strategies
   */
  getStrategies(): {
    candidate: DeltaCandidateStrategy;
    compute: DeltaComputeStrategy;
  };

  // ========== Delta Operations ==========

  /**
   * Deltify an object
   *
   * Uses configured strategies to find best base and compute delta.
   *
   * @param targetId Object to deltify
   * @param options Deltification options
   * @returns True if object was deltified
   */
  deltify(targetId: ObjectId, options?: DeltaComputeOptions): Promise<boolean>;

  /**
   * Deltify with explicit candidates
   *
   * Bypasses candidate strategy to use provided bases.
   *
   * @param targetId Object to deltify
   * @param candidateIds Explicit base candidates
   * @param options Deltification options
   * @returns True if object was deltified
   */
  deltifyWith(
    targetId: ObjectId,
    candidateIds: ObjectId[],
    options?: DeltaComputeOptions,
  ): Promise<boolean>;

  /**
   * Undeltify an object (convert to full content)
   *
   * Writes full content to loose storage and removes delta.
   *
   * @param id Object to undeltify
   */
  undeltify(id: ObjectId): Promise<void>;

  /**
   * Check if object is stored as delta
   */
  isDelta(id: ObjectId): Promise<boolean>;

  /**
   * Get delta chain information
   */
  getDeltaChainInfo(id: ObjectId): Promise<DeltaChainDetails | undefined>;

  // ========== Analysis & Maintenance ==========

  /**
   * Analyze repository for packing opportunities
   */
  analyzeRepository(): Promise<RepositoryAnalysis>;

  /**
   * Get packing suggestions
   *
   * Analyzes current state and suggests deltification candidates.
   */
  suggestPacking(options?: { commitScope?: ObjectId }): Promise<PackingSuggestion>;

  /**
   * Repack repository
   *
   * Creates optimized delta chains, consolidates packs, prunes loose objects.
   */
  repack(options?: RepackOptions): Promise<RepackResult>;

  /**
   * Quick pack after a commit
   *
   * Lightweight operation to deltify new objects from a commit
   * without full repository repack.
   *
   * @param commitId Commit that was just created
   * @returns Number of objects deltified
   */
  quickPack(commitId: ObjectId): Promise<number>;

  /**
   * Prune loose objects that are in delta backend
   *
   * @returns Number of objects pruned
   */
  pruneLooseObjects(): Promise<number>;

  // ========== Stats ==========

  /**
   * Get combined statistics
   */
  getStats(): Promise<{
    loose: { count: number; size: number };
    delta: DeltaChainStoreStats;
  }>;
}
