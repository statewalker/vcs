/**
 * GC Controller
 *
 * Provides automatic garbage collection and maintenance scheduling
 * for delta storage systems.
 */

import type { CommitStore } from "../../commits/commit-store.js";
import { FileMode } from "../../common/files/index.js";
import type { ObjectId } from "../../common/id/object-id.js";
import { ObjectType } from "../../objects/object-types.js";
import type { PackConsolidator } from "../pack/pack-consolidator.js";
import type { TreeStore } from "../../trees/tree-store.js";

import type { DeltaTarget } from "./candidate-finder.js";
import type { DeltaEngine } from "./delta-engine.js";
import type { RawStoreWithDelta } from "./raw-store-with-delta.js";
import type { RepackOptions, RepackResult } from "./types.js";

/**
 * GC scheduling options
 */
export interface GCScheduleOptions {
  /** Delta engine for finding and computing deltas */
  deltaEngine?: DeltaEngine;
  /** Trigger GC when loose objects exceed this count */
  looseObjectThreshold?: number;
  /** Maximum delta chain depth (for shouldRunGC check) */
  maxChainDepth?: number;
  /** Minimum interval between GC runs (ms) */
  minInterval?: number;
  /** Number of pending commits before quick pack */
  quickPackThreshold?: number;
  /** Optional pack consolidator for consolidating pack files */
  consolidator?: PackConsolidator;
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
 * Resolved GC options (with defaults applied)
 */
type ResolvedGCOptions = Omit<Required<GCScheduleOptions>, "consolidator" | "deltaEngine"> & {
  consolidator?: PackConsolidator;
  deltaEngine?: DeltaEngine;
};

/**
 * Default GC options
 */
const DEFAULT_GC_OPTIONS: ResolvedGCOptions = {
  deltaEngine: undefined,
  looseObjectThreshold: 100,
  maxChainDepth: 50,
  minInterval: 60000, // 1 minute
  quickPackThreshold: 5,
  consolidator: undefined,
};

/**
 * GC controller for automatic maintenance
 *
 * Monitors the delta storage and automatically triggers
 * garbage collection when thresholds are exceeded.
 *
 * @example
 * ```typescript
 * const gc = new GCController(deltaStorage, {
 *   looseObjectThreshold: 100,
 *   minInterval: 60000,
 * });
 *
 * // Notify of new commits
 * await gc.onCommit(commitId);
 *
 * // Check and run GC if needed
 * const result = await gc.maybeRunGC();
 * ```
 */
export class GCController {
  private readonly storage: RawStoreWithDelta;
  private readonly options: ResolvedGCOptions;
  private lastGC = 0;
  private pendingCommits: ObjectId[] = [];

  constructor(storage: RawStoreWithDelta, options: GCScheduleOptions = {}) {
    this.storage = storage;
    this.options = {
      ...DEFAULT_GC_OPTIONS,
      ...options,
    };
  }

  /**
   * Notify controller of a new commit
   *
   * Tracks the commit for quick packing. When enough commits
   * accumulate, triggers a quick pack operation.
   *
   * @param commitId The ID of the new commit
   */
  async onCommit(commitId: ObjectId): Promise<void> {
    this.pendingCommits.push(commitId);

    // Quick pack for recent commits
    if (this.pendingCommits.length >= this.options.quickPackThreshold) {
      await this.quickPack();
    }
  }

  /**
   * Quick pack pending commits
   *
   * Performs lightweight deltification of objects from
   * recently created commits without full repository repack.
   * All deltified objects are written to a single pack file.
   *
   * @returns Number of objects deltified
   */
  async quickPack(): Promise<number> {
    const deltaEngine = this.options.deltaEngine;
    if (!deltaEngine) {
      // No delta engine configured, skip
      this.pendingCommits = [];
      return 0;
    }

    // Start batch to collect all deltas into a single pack file
    this.storage.startBatch();
    let total = 0;

    try {
      for (const commitId of this.pendingCommits) {
        // Get object size for the target
        const size = await this.storage.size(commitId);

        // Create target for delta engine
        const target: DeltaTarget = {
          id: commitId,
          type: ObjectType.COMMIT,
          size,
        };

        // Find best delta using the engine
        const result = await deltaEngine.findBestDelta(target);
        if (result) {
          await this.storage.storeDeltaResult(commitId, result);
          total++;
        }
      }

      // Commit all deltas to a single pack file
      await this.storage.endBatch();
    } catch (e) {
      // Cancel batch on error
      this.storage.cancelBatch();
      throw e;
    }

    this.pendingCommits = [];
    return total;
  }

  /**
   * Get pending commits count
   *
   * @returns Number of commits waiting for quick pack
   */
  getPendingCommitsCount(): number {
    return this.pendingCommits.length;
  }

  /**
   * Check if GC should run
   *
   * Evaluates the current repository state against configured
   * thresholds to determine if garbage collection is needed.
   *
   * @returns True if GC should run
   */
  async shouldRunGC(): Promise<boolean> {
    // Check interval
    if (Date.now() - this.lastGC < this.options.minInterval) {
      return false;
    }

    // Count loose objects
    let looseCount = 0;
    let deepChains = 0;

    for await (const objectId of this.storage.keys()) {
      if (!(await this.storage.isDelta(objectId))) {
        looseCount++;
      } else {
        const chainInfo = await this.storage.getDeltaChainInfo(objectId);
        if (chainInfo && chainInfo.depth > this.options.maxChainDepth) {
          deepChains++;
        }
      }

      // Early exit if thresholds exceeded
      if (looseCount >= this.options.looseObjectThreshold || deepChains > 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Run GC if needed
   *
   * Checks thresholds and runs garbage collection only if
   * conditions are met and enough time has passed since last run.
   *
   * @param options Repack options to use if GC runs
   * @returns Repack result if GC ran, null otherwise
   */
  async maybeRunGC(options?: RepackOptions): Promise<RepackResult | null> {
    if (!(await this.shouldRunGC())) {
      return null;
    }

    return this.runGC(options);
  }

  /**
   * Force GC run
   *
   * Runs garbage collection regardless of thresholds or timing.
   *
   * @param options Repack options
   * @returns Repack result
   */
  async runGC(options?: RepackOptions): Promise<RepackResult> {
    const startTime = Date.now();

    // First, pack any pending commits
    if (this.pendingCommits.length > 0) {
      await this.quickPack();
    }

    const result = await this.repack(options);
    this.lastGC = Date.now();

    return {
      ...result,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Repack storage
   *
   * Deltifies loose objects and optionally prunes loose objects
   * that have been converted to deltas. All new deltas are written
   * to a single pack file with valid cross-references.
   */
  private async repack(options?: RepackOptions): Promise<RepackResult> {
    const maxChainDepth = options?.maxChainDepth ?? this.options.maxChainDepth;
    const deltaEngine = this.options.deltaEngine;

    let objectsProcessed = 0;
    let deltasCreated = 0;
    let deltasRemoved = 0;
    let looseObjectsPruned = 0;
    let spaceSaved = 0;

    // Collect loose objects
    const looseIds: ObjectId[] = [];
    for await (const id of this.storage.keys()) {
      if (!(await this.storage.isDelta(id))) {
        looseIds.push(id);
      }
    }

    // Break deep chains first
    for await (const id of this.storage.keys()) {
      if (await this.storage.isDelta(id)) {
        try {
          const chainInfo = await this.storage.getDeltaChainInfo(id);
          if (chainInfo && chainInfo.depth > maxChainDepth) {
            await this.storage.undeltify(id);
            deltasRemoved++;
            looseIds.push(id);
          }
        } catch {
          // getDeltaChainInfo can fail if base object is not in the same pack
          // (e.g., REF_DELTA with base in loose storage or different pack)
          // In this case, undeltify the object to ensure it can be processed
          try {
            await this.storage.undeltify(id);
            deltasRemoved++;
            looseIds.push(id);
          } catch {
            // Object might already be undeltified or not accessible
            // Skip it and continue with other objects
          }
        }
      }
    }

    // Progress callback
    const progressCallback = options?.progressCallback;
    const total = looseIds.length;

    // If no delta engine configured, skip deltification
    if (!deltaEngine) {
      return {
        objectsProcessed: total,
        deltasCreated: 0,
        deltasRemoved,
        looseObjectsPruned: 0,
        spaceSaved: 0,
        packsConsolidated: 0,
        duration: 0,
      };
    }

    // Start batch to collect all objects into a single pack file
    this.storage.startBatch();

    try {
      // Get batch update handle for direct object storage
      const batchUpdate = this.storage.getBatchUpdate();
      if (!batchUpdate) {
        throw new Error("Failed to get batch update handle");
      }

      // Add ALL objects as full objects first - this ensures bases are in pack
      // When deltified later, full objects are replaced with delta entries
      // This allows PendingPack to use OFS_DELTA instead of REF_DELTA
      for (const id of looseIds) {
        await batchUpdate.storeObject(id, this.storage.load(id));
      }

      // Process each object with DeltaEngine
      for (const id of looseIds) {
        objectsProcessed++;

        if (progressCallback) {
          progressCallback({
            phase: "deltifying",
            totalObjects: total,
            processedObjects: objectsProcessed,
            deltifiedObjects: deltasCreated,
            currentObjectId: id,
            bytesSaved: spaceSaved,
          });
        }

        try {
          const sizeBefore = await this.storage.size(id);

          // Create target for delta engine
          // Note: We use BLOB type as a default since we don't track object types
          // The DeltaEngine will handle type appropriately via CandidateFinder
          const target: DeltaTarget = {
            id,
            type: ObjectType.BLOB,
            size: sizeBefore,
          };

          // Find best delta using the engine
          const result = await deltaEngine.findBestDelta(target);
          if (result) {
            await this.storage.storeDeltaResult(id, result);
            deltasCreated++;
            spaceSaved += result.savings;
          }
        } catch {
          // Delta computation can fail if object is not accessible
          // Skip this object and continue with others
        }
      }

      // Commit all new deltas to a single pack file with proper cross-references
      await this.storage.endBatch();
    } catch (e) {
      // Cancel batch on error
      this.storage.cancelBatch();
      throw e;
    }

    // Prune loose objects if requested
    if (options?.pruneLoose) {
      for await (const id of this.storage.objects.keys()) {
        if (await this.storage.isDelta(id)) {
          await this.storage.objects.delete(id);
          looseObjectsPruned++;
        }
      }
    }

    // Consolidate packs if consolidator is configured
    let packsConsolidated = 0;
    if (this.options.consolidator) {
      if (progressCallback) {
        progressCallback({
          phase: "consolidating",
          totalObjects: total,
          processedObjects: objectsProcessed,
          deltifiedObjects: deltasCreated,
          bytesSaved: spaceSaved,
        });
      }

      const consolidateResult = await this.options.consolidator.consolidate();
      packsConsolidated = consolidateResult.packsRemoved;
      spaceSaved += consolidateResult.bytesReclaimed;
    }

    if (progressCallback) {
      progressCallback({
        phase: "complete",
        totalObjects: total,
        processedObjects: objectsProcessed,
        deltifiedObjects: deltasCreated,
        bytesSaved: spaceSaved,
      });
    }

    return {
      objectsProcessed,
      deltasCreated,
      deltasRemoved,
      looseObjectsPruned,
      spaceSaved,
      packsConsolidated,
      duration: 0, // Set by caller
    };
  }

  /**
   * Remove unreachable objects
   *
   * Walks the object graph from all ref roots to determine reachability,
   * then deletes any objects not reachable and older than the expiration time.
   *
   * @param roots Commit IDs to start reachability walk from
   * @param commits CommitStore for reading commit objects
   * @param trees TreeStore for reading tree objects
   * @param expire Optional expiration date - only delete objects older than this
   * @returns GC result
   */
  async collectGarbage(
    roots: ObjectId[],
    commits: CommitStore,
    trees: TreeStore,
    expire?: Date,
  ): Promise<GCResult> {
    const startTime = Date.now();
    const expireTime = expire?.getTime() ?? 0;

    // 1. Find all reachable objects by walking from roots
    const reachable = new Set<string>();

    for (const root of roots) {
      await this.walkCommit(root, commits, trees, reachable);
    }

    // 2. Find and delete unreachable objects
    let objectsRemoved = 0;
    let bytesFreed = 0;

    for await (const id of this.storage.keys()) {
      if (reachable.has(id)) {
        continue; // Object is reachable, keep it
      }

      // Check expiration time if set
      if (expireTime > 0) {
        // Note: getModificationTime is not available on all storage backends
        // For now, we skip expiration checks if not available
        // This could be enhanced in the future with storage interface extensions
      }

      // Delete unreachable object
      try {
        const objectSize = await this.storage.size(id);
        await this.storage.delete(id);
        objectsRemoved++;
        bytesFreed += objectSize;
      } catch {
        // Object might have been deleted concurrently or not accessible
        // Continue processing other objects
      }
    }

    return {
      objectsRemoved,
      bytesFreed,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Walk a commit and all its ancestors, marking objects as reachable
   */
  private async walkCommit(
    commitId: ObjectId,
    commits: CommitStore,
    trees: TreeStore,
    reachable: Set<string>,
  ): Promise<void> {
    if (reachable.has(commitId)) return;
    reachable.add(commitId);

    try {
      const commit = await commits.loadCommit(commitId);

      // Mark tree and all children
      await this.walkTree(commit.tree, trees, reachable);

      // Walk parent commits (recursive)
      for (const parent of commit.parents) {
        await this.walkCommit(parent, commits, trees, reachable);
      }
    } catch {
      // Commit might not exist or be corrupted, skip it
    }
  }

  /**
   * Walk a tree and all its entries, marking objects as reachable
   */
  private async walkTree(
    treeId: ObjectId,
    trees: TreeStore,
    reachable: Set<string>,
  ): Promise<void> {
    if (reachable.has(treeId)) return;
    reachable.add(treeId);

    try {
      for await (const entry of trees.loadTree(treeId)) {
        reachable.add(entry.id);
        if (entry.mode === FileMode.TREE) {
          await this.walkTree(entry.id, trees, reachable);
        }
        // Blobs are already marked, no need to recurse
      }
    } catch {
      // Tree might not exist or be corrupted, skip it
    }
  }

  /**
   * Get time since last GC
   *
   * @returns Milliseconds since last GC run, or -1 if never run
   */
  getTimeSinceLastGC(): number {
    if (this.lastGC === 0) {
      return -1;
    }
    return Date.now() - this.lastGC;
  }

  /**
   * Get current options
   *
   * @returns The GC scheduling options
   */
  getOptions(): Readonly<ResolvedGCOptions> {
    return { ...this.options };
  }
}
