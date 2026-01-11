/**
 * Packing Orchestrator
 *
 * Coordinates the packing process using a sliding window algorithm.
 * Orchestrates storage analysis, candidate selection, and deltification.
 */

// import type { CommitStore, TagStore, TreeStore } from "../stores/index.js";
import type { CommitStore } from "../../commits/commit-store.js";
import type { ObjectId } from "../../common/id/object-id.js";
import type { TagStore } from "../../tags/tag-store.js";
import type { TreeStore } from "../../trees/tree-store.js";
import type { RawStoreWithDelta } from "./raw-store-with-delta.js";
import { StorageAnalyzer } from "./storage-analyzer.js";
import type { PackingCandidate, PackingOptions, PackingProgress, PackingResult } from "./types.js";

/**
 * Context aggregating all storages required for packing operations
 */
export interface PackingContext {
  /** Delta storage implementation (provides object access and delta operations) */
  objects: RawStoreWithDelta;
  /** Tree storage for path-based candidate selection */
  trees: TreeStore;
  /** Commit storage for version-based traversal */
  commits: CommitStore;
  /** Tag storage (optional, rarely needed for packing) */
  tags?: TagStore;
}

/**
 * Default packing options following JGit conventions
 */
const DEFAULT_OPTIONS: Required<Omit<PackingOptions, "progressCallback" | "signal">> = {
  windowSize: 10,
  maxChainDepth: 50,
  minObjectSize: 50,
  minCompressionRatio: 0.75,
  dryRun: false,
};

/**
 * Entry in the sliding window
 */
interface WindowEntry {
  objectId: ObjectId;
  size: number;
  depth: number;
}

/**
 * Orchestrates the packing process using a sliding window algorithm
 *
 * Coordinates storage analysis, candidate selection, and deltification
 * to optimize storage efficiency. Inspired by JGit's PackWriter and DeltaWindow.
 */
export class PackingOrchestrator {
  private readonly analyzer: StorageAnalyzer;

  constructor() {
    this.analyzer = new StorageAnalyzer();
  }

  /**
   * Pack all objects in storage
   *
   * Analyzes storage content and applies delta compression where beneficial.
   * Uses a sliding window algorithm to maintain candidates for comparison.
   *
   * @param context Packing context with all storages
   * @param options Packing options
   * @returns Packing result with statistics
   */
  async packAll(context: PackingContext, options: PackingOptions = {}): Promise<PackingResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();

    // Analyze storage
    this.reportProgress(opts, {
      phase: "analyzing",
      totalObjects: 0,
      processedObjects: 0,
      deltifiedObjects: 0,
      bytesSaved: 0,
    });

    const analysis = await this.analyzer.analyzeAll(context, {
      minSize: opts.minObjectSize,
      signal: opts.signal,
    });

    // Filter and sort candidates
    const candidates = this.prepareCandidates(analysis.packingCandidates, opts);

    return this.packCandidates(context, candidates, opts, startTime);
  }

  /**
   * Pack objects reachable from commit roots
   *
   * Focused packing that only processes objects reachable from
   * specified commits. Provides better candidate selection through
   * path context.
   *
   * @param context Packing context
   * @param roots Starting commit IDs
   * @param options Packing options
   * @returns Packing result
   */
  async packFromRoots(
    context: PackingContext,
    roots: ObjectId[],
    options: PackingOptions = {},
  ): Promise<PackingResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();

    this.reportProgress(opts, {
      phase: "analyzing",
      totalObjects: 0,
      processedObjects: 0,
      deltifiedObjects: 0,
      bytesSaved: 0,
    });

    const analysis = await this.analyzer.analyzeFromRoots(context, roots, {
      minSize: opts.minObjectSize,
      signal: opts.signal,
    });

    const candidates = this.prepareCandidates(analysis.packingCandidates, opts);

    return this.packCandidates(context, candidates, opts, startTime);
  }

  /**
   * Incremental packing - only pack new objects
   *
   * Useful for packing recent additions without reprocessing
   * the entire storage.
   *
   * @param context Packing context
   * @param newObjectIds Objects to consider for packing
   * @param options Packing options
   * @returns Packing result
   */
  async packIncremental(
    context: PackingContext,
    newObjectIds: ObjectId[],
    options: PackingOptions = {},
  ): Promise<PackingResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();

    // Build candidates from new objects
    const candidates: PackingCandidate[] = [];

    for (const objectId of newObjectIds) {
      const size = await context.objects.size(objectId);
      if (size < 0) continue;
      if (size < opts.minObjectSize) continue;

      const chainInfo = await context.objects.getDeltaChainInfo(objectId);
      const depth = chainInfo?.depth ?? 0;

      candidates.push({
        objectId,
        objectType: "blob",
        size,
        currentDepth: depth,
        suggestedBases: [],
      });
    }

    // Sort by size descending
    candidates.sort((a, b) => b.size - a.size);

    return this.packCandidates(context, candidates, opts, startTime);
  }

  /**
   * Main packing loop using sliding window algorithm
   */
  private async packCandidates(
    context: PackingContext,
    candidates: PackingCandidate[],
    opts: Required<Omit<PackingOptions, "progressCallback" | "signal">> & PackingOptions,
    startTime: number,
  ): Promise<PackingResult> {
    const window: WindowEntry[] = [];
    const chainDepthDistribution = new Map<number, number>();
    let objectsAnalyzed = 0;
    let objectsDeltified = 0;
    let bytesSaved = 0;
    let totalOriginalSize = 0;
    let totalFinalSize = 0;

    this.reportProgress(opts, {
      phase: "selecting",
      totalObjects: candidates.length,
      processedObjects: 0,
      deltifiedObjects: 0,
      bytesSaved: 0,
    });

    for (const candidate of candidates) {
      if (opts.signal?.aborted) {
        throw new DOMException("Packing aborted", "AbortError");
      }

      objectsAnalyzed++;
      const originalSize = candidate.size;
      totalOriginalSize += originalSize;

      this.reportProgress(opts, {
        phase: "deltifying",
        totalObjects: candidates.length,
        processedObjects: objectsAnalyzed,
        deltifiedObjects: objectsDeltified,
        currentObjectId: candidate.objectId,
        bytesSaved,
      });

      // Skip objects already at max depth
      if (candidate.currentDepth >= opts.maxChainDepth) {
        this.addToWindow(window, candidate, opts.windowSize);
        totalFinalSize += originalSize;
        continue;
      }

      // Get candidates from window
      const windowCandidates = window
        .filter((w) => w.depth < opts.maxChainDepth)
        .map((w) => w.objectId);

      if (windowCandidates.length === 0) {
        this.addToWindow(window, candidate, opts.windowSize);
        totalFinalSize += originalSize;
        continue;
      }

      // Try deltification
      if (!opts.dryRun) {
        const success = await context.objects.deltify(candidate.objectId, windowCandidates, {
          maxRatio: opts.minCompressionRatio,
          minSize: opts.minObjectSize,
        });

        if (success) {
          objectsDeltified++;

          // Get new chain info
          const newChainInfo = await context.objects.getDeltaChainInfo(candidate.objectId);
          if (newChainInfo) {
            const savings = originalSize - newChainInfo.compressedSize;
            bytesSaved += savings;
            totalFinalSize += newChainInfo.compressedSize;

            // Update depth distribution
            const depthCount = chainDepthDistribution.get(newChainInfo.depth) ?? 0;
            chainDepthDistribution.set(newChainInfo.depth, depthCount + 1);

            // Update candidate depth
            candidate.currentDepth = newChainInfo.depth;
          }
        } else {
          totalFinalSize += originalSize;
        }
      } else {
        // Dry run - estimate based on typical compression
        const estimatedSavings = originalSize * 0.5;
        bytesSaved += estimatedSavings;
        objectsDeltified++;
        totalFinalSize += originalSize - estimatedSavings;
      }

      // Add to window
      this.addToWindow(window, candidate, opts.windowSize);
    }

    this.reportProgress(opts, {
      phase: "complete",
      totalObjects: candidates.length,
      processedObjects: objectsAnalyzed,
      deltifiedObjects: objectsDeltified,
      bytesSaved,
    });

    const averageCompressionRatio = totalOriginalSize > 0 ? totalFinalSize / totalOriginalSize : 1;

    return {
      objectsAnalyzed,
      objectsDeltified,
      bytesSaved,
      averageCompressionRatio,
      chainDepthDistribution,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Prepare candidates for packing
   *
   * Filters and sorts candidates according to JGit patterns:
   * - Sort by size descending ("Linus' Law")
   * - Skip objects below minimum size
   * - Skip objects already at max depth
   */
  private prepareCandidates(
    candidates: PackingCandidate[],
    opts: Required<Omit<PackingOptions, "progressCallback" | "signal">>,
  ): PackingCandidate[] {
    return candidates
      .filter((c) => c.size >= opts.minObjectSize)
      .filter((c) => c.currentDepth < opts.maxChainDepth)
      .sort((a, b) => b.size - a.size);
  }

  /**
   * Add entry to sliding window
   */
  private addToWindow(
    window: WindowEntry[],
    candidate: PackingCandidate,
    windowSize: number,
  ): void {
    window.push({
      objectId: candidate.objectId,
      size: candidate.size,
      depth: candidate.currentDepth,
    });

    // Maintain window size
    while (window.length > windowSize) {
      window.shift();
    }
  }

  /**
   * Report progress to callback
   */
  private reportProgress(opts: PackingOptions, progress: PackingProgress): void {
    if (opts.progressCallback) {
      opts.progressCallback(progress);
    }
  }
}
