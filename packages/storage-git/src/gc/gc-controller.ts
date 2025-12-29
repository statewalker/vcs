/**
 * GC Controller
 *
 * Provides automatic garbage collection and maintenance scheduling
 * for delta storage systems.
 */

import type { ObjectId } from "@webrun-vcs/core";
import type { DeltaStorageImpl } from "../delta/index.js";
import type { GCResult, GCScheduleOptions, RepackOptions, RepackResult } from "./types.js";

/**
 * Default GC options
 */
const DEFAULT_GC_OPTIONS: Required<GCScheduleOptions> = {
  looseObjectThreshold: 100,
  chainDepthThreshold: 50,
  minInterval: 60000, // 1 minute
  quickPackThreshold: 5,
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
  private readonly storage: DeltaStorageImpl;
  private readonly options: Required<GCScheduleOptions>;
  private lastGC = 0;
  private pendingCommits: ObjectId[] = [];

  constructor(storage: DeltaStorageImpl, options: GCScheduleOptions = {}) {
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
   *
   * @returns Number of objects deltified
   */
  async quickPack(): Promise<number> {
    if (!this.storage.getStrategies().candidate || !this.storage.getStrategies().compute) {
      // No strategies configured, skip
      this.pendingCommits = [];
      return 0;
    }

    let total = 0;
    for (const commitId of this.pendingCommits) {
      // Try to deltify the commit object itself
      const success = await this.storage.deltify(commitId);
      if (success) total++;
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

    for await (const objectId of this.storage.listObjects()) {
      if (!(await this.storage.isDelta(objectId))) {
        looseCount++;
      } else {
        const chainInfo = await this.storage.getDeltaChainInfo(objectId);
        if (chainInfo && chainInfo.depth > this.options.chainDepthThreshold) {
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
   * that have been converted to deltas.
   */
  private async repack(options?: RepackOptions): Promise<RepackResult> {
    const maxChainDepth = options?.maxChainDepth ?? this.options.chainDepthThreshold;
    const windowSize = options?.windowSize ?? 10;

    let objectsProcessed = 0;
    let deltasCreated = 0;
    let deltasRemoved = 0;
    let looseObjectsPruned = 0;
    let spaceSaved = 0;

    // Collect loose objects
    const looseIds: ObjectId[] = [];
    for await (const id of this.storage.listObjects()) {
      if (!(await this.storage.isDelta(id))) {
        looseIds.push(id);
      }
    }

    // Break deep chains first
    for await (const id of this.storage.listObjects()) {
      if (await this.storage.isDelta(id)) {
        const chainInfo = await this.storage.getDeltaChainInfo(id);
        if (chainInfo && chainInfo.depth > maxChainDepth) {
          await this.storage.undeltify(id);
          deltasRemoved++;
          looseIds.push(id);
        }
      }
    }

    // Progress callback
    const progressCallback = options?.progressCallback;
    const total = looseIds.length;

    // Deltify using sliding window
    for (let i = 0; i < looseIds.length; i++) {
      const id = looseIds[i];
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

      // Get candidates from window
      const windowStart = Math.max(0, i - windowSize);
      const candidates = looseIds.slice(windowStart, i);

      if (candidates.length > 0 && this.storage.getStrategies().compute) {
        const sizeBefore = await this.storage.getSize(id);
        const success = await this.storage.deltifyWith(id, candidates);

        if (success) {
          deltasCreated++;
          const chainInfo = await this.storage.getDeltaChainInfo(id);
          if (chainInfo) {
            spaceSaved += sizeBefore - chainInfo.compressedSize;
          }
        }
      }
    }

    // Prune loose objects if requested
    if (options?.pruneLoose) {
      for await (const id of this.storage.raw.keys()) {
        if (await this.storage.isDelta(id)) {
          await this.storage.raw.delete(id);
          looseObjectsPruned++;
        }
      }
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
      duration: 0, // Set by caller
    };
  }

  /**
   * Remove unreachable objects
   *
   * @param roots Commit roots to determine reachability
   * @returns GC result
   */
  async collectGarbage(_roots: ObjectId[]): Promise<GCResult> {
    const startTime = Date.now();

    // Find reachable objects by walking from roots
    const _reachable = new Set<ObjectId>();

    // Note: This requires CommitStore and TreeStore access
    // For now, this is a simplified version that just removes
    // objects explicitly marked for deletion

    // In a full implementation, you would:
    // 1. Walk from each root commit
    // 2. Follow tree references
    // 3. Mark all visited objects as reachable
    // 4. Delete everything not reachable

    const objectsRemoved = 0;
    const bytesFreed = 0;

    // For now, just return empty result
    // Full implementation needs CommitStore/TreeStore access

    return {
      objectsRemoved,
      bytesFreed,
      durationMs: Date.now() - startTime,
    };
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
  getOptions(): Readonly<Required<GCScheduleOptions>> {
    return { ...this.options };
  }
}
