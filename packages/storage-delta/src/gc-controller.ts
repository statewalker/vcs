/**
 * GC Controller for automatic maintenance
 *
 * Provides automatic garbage collection and maintenance scheduling
 * for delta storage systems.
 */

import type { DeltaStorage, ObjectId, RepackOptions, RepackResult } from "@webrun-vcs/storage";

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
  private readonly storage: DeltaStorage;
  private readonly options: Required<GCScheduleOptions>;
  private lastGC = 0;
  private pendingCommits: ObjectId[] = [];

  constructor(storage: DeltaStorage, options: GCScheduleOptions = {}) {
    this.storage = storage;
    this.options = {
      looseObjectThreshold: options.looseObjectThreshold ?? 100,
      chainDepthThreshold: options.chainDepthThreshold ?? 50,
      minInterval: options.minInterval ?? 60000, // 1 minute
      quickPackThreshold: options.quickPackThreshold ?? 5,
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
    let total = 0;
    for (const commitId of this.pendingCommits) {
      total += await this.storage.quickPack(commitId);
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

    // Check thresholds
    const analysis = await this.storage.analyzeRepository();

    return analysis.looseObjects >= this.options.looseObjectThreshold || analysis.deepChains > 0;
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
    // First, pack any pending commits
    if (this.pendingCommits.length > 0) {
      await this.quickPack();
    }

    const result = await this.storage.repack(options);
    this.lastGC = Date.now();
    return result;
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
