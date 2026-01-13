/**
 * GC Controller
 *
 * Garbage collection controller that uses StorageBackend.
 * Focuses on blob-only delta compression as per the unified architecture.
 */

import type { StorageBackend } from "../../backend/storage-backend.js";
import { FileMode } from "../../common/files/index.js";
import type { ObjectId } from "../../common/id/object-id.js";
import { ObjectType } from "../../history/objects/object-types.js";

import type { DeltaTarget } from "./candidate-finder.js";
import type { BestDeltaResult, DeltaEngine } from "./delta-engine.js";
import type { RepackOptions, RepackResult } from "./types.js";

/**
 * GC scheduling options for V2 controller
 */
export interface GCScheduleOptions {
  /** Delta engine for finding and computing deltas */
  deltaEngine?: DeltaEngine;
  /** Trigger GC when loose blob count exceeds this */
  looseBlobThreshold?: number;
  /** Maximum delta chain depth */
  maxChainDepth?: number;
  /** Minimum interval between GC runs (ms) */
  minInterval?: number;
  /** Number of pending blobs before quick pack */
  quickPackThreshold?: number;
}

/**
 * GC result
 */
export interface GCResult {
  /** Number of blobs removed */
  blobsRemoved: number;
  /** Bytes freed */
  bytesFreed: number;
  /** Duration in ms */
  durationMs: number;
}

/**
 * Resolved GC options (with defaults applied)
 */
type ResolvedGCOptions = Omit<Required<GCScheduleOptions>, "deltaEngine"> & {
  deltaEngine?: DeltaEngine;
};

/**
 * Default GC options
 */
const DEFAULT_GC_OPTIONS: ResolvedGCOptions = {
  deltaEngine: undefined,
  looseBlobThreshold: 100,
  maxChainDepth: 50,
  minInterval: 60000, // 1 minute
  quickPackThreshold: 5,
};

/**
 * GC Controller V2 - Uses StorageBackend
 *
 * Simplified GC controller that focuses on blob-only delta compression.
 * Uses the unified StorageBackend interface instead of RawStoreWithDelta.
 *
 * Key differences from V1:
 * - Only processes blobs (trees and commits are not deltified)
 * - Uses StorageBackend.delta API for all delta operations
 * - Uses StorageBackend.structured for object access
 *
 * @example
 * ```typescript
 * const gc = new GCController(backend, {
 *   deltaEngine: myDeltaEngine,
 *   looseBlobThreshold: 100,
 * });
 *
 * // Check and run GC if needed
 * const result = await gc.maybeRunGC();
 * ```
 */
export class GCController {
  private readonly backend: StorageBackend;
  private readonly options: ResolvedGCOptions;
  private lastGC = 0;
  private pendingBlobs: ObjectId[] = [];

  constructor(backend: StorageBackend, options: GCScheduleOptions = {}) {
    this.backend = backend;
    this.options = {
      ...DEFAULT_GC_OPTIONS,
      ...options,
    };
  }

  /**
   * Notify controller of a new blob
   *
   * Tracks the blob for quick packing. When enough blobs
   * accumulate, triggers a quick pack operation.
   *
   * @param blobId The ID of the new blob
   */
  async onBlob(blobId: ObjectId): Promise<void> {
    this.pendingBlobs.push(blobId);

    if (this.pendingBlobs.length >= this.options.quickPackThreshold) {
      await this.quickPack();
    }
  }

  /**
   * Quick pack pending blobs
   *
   * Performs lightweight deltification of recently created blobs
   * without full repository repack.
   *
   * @returns Number of blobs deltified
   */
  async quickPack(): Promise<number> {
    const deltaEngine = this.options.deltaEngine;
    if (!deltaEngine) {
      this.pendingBlobs = [];
      return 0;
    }

    const deltaApi = this.backend.delta;
    deltaApi.startBatch();

    let total = 0;

    try {
      for (const blobId of this.pendingBlobs) {
        const size = await this.backend.structured.blobs.size(blobId);

        const target: DeltaTarget = {
          id: blobId,
          type: ObjectType.BLOB,
          size,
        };

        const result = await deltaEngine.findBestDelta(target);
        if (result) {
          await this.storeDeltaResult(blobId, result);
          total++;
        }
      }

      await deltaApi.endBatch();
    } catch (e) {
      deltaApi.cancelBatch();
      throw e;
    }

    this.pendingBlobs = [];
    return total;
  }

  /**
   * Get pending blobs count
   */
  getPendingBlobsCount(): number {
    return this.pendingBlobs.length;
  }

  /**
   * Check if GC should run
   *
   * Evaluates current state against thresholds.
   */
  async shouldRunGC(): Promise<boolean> {
    if (Date.now() - this.lastGC < this.options.minInterval) {
      return false;
    }

    let looseCount = 0;
    let deepChains = 0;

    for await (const id of this.backend.structured.blobs.keys()) {
      if (!(await this.backend.delta.isDelta(id))) {
        looseCount++;
      } else {
        const chainInfo = await this.backend.delta.getDeltaChain(id);
        if (chainInfo && chainInfo.depth > this.options.maxChainDepth) {
          deepChains++;
        }
      }

      if (looseCount >= this.options.looseBlobThreshold || deepChains > 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Run GC if needed
   */
  async maybeRunGC(options?: RepackOptions): Promise<RepackResult | null> {
    if (!(await this.shouldRunGC())) {
      return null;
    }
    return this.runGC(options);
  }

  /**
   * Force GC run
   */
  async runGC(options?: RepackOptions): Promise<RepackResult> {
    const startTime = Date.now();

    if (this.pendingBlobs.length > 0) {
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
   * Repack storage - blob-only deltification
   */
  private async repack(options?: RepackOptions): Promise<RepackResult> {
    const maxChainDepth = options?.maxChainDepth ?? this.options.maxChainDepth;
    const deltaEngine = this.options.deltaEngine;
    const deltaApi = this.backend.delta;
    const blobs = this.backend.structured.blobs;

    let objectsProcessed = 0;
    let deltasCreated = 0;
    let deltasRemoved = 0;
    const looseObjectsPruned = 0;
    let spaceSaved = 0;

    // Collect loose blobs (not stored as delta)
    const looseIds: ObjectId[] = [];
    for await (const id of blobs.keys()) {
      if (!(await deltaApi.isDelta(id))) {
        looseIds.push(id);
      }
    }

    // Break deep chains first
    for await (const id of blobs.keys()) {
      if (await deltaApi.isDelta(id)) {
        try {
          const chainInfo = await deltaApi.getDeltaChain(id);
          if (chainInfo && chainInfo.depth > maxChainDepth) {
            await deltaApi.blobs.undeltifyBlob(id);
            deltasRemoved++;
            looseIds.push(id);
          }
        } catch {
          // Chain info unavailable - undeltify to be safe
          try {
            await deltaApi.blobs.undeltifyBlob(id);
            deltasRemoved++;
            looseIds.push(id);
          } catch {
            // Skip if undeltify fails
          }
        }
      }
    }

    const progressCallback = options?.progressCallback;
    const total = looseIds.length;

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

    deltaApi.startBatch();

    try {
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
          const sizeBefore = await blobs.size(id);

          const target: DeltaTarget = {
            id,
            type: ObjectType.BLOB,
            size: sizeBefore,
          };

          const result = await deltaEngine.findBestDelta(target);
          if (result) {
            await this.storeDeltaResult(id, result);
            deltasCreated++;
            spaceSaved += result.savings;
          }
        } catch {
          // Skip objects that fail
        }
      }

      await deltaApi.endBatch();
    } catch (e) {
      deltaApi.cancelBatch();
      throw e;
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
      packsConsolidated: 0,
      duration: 0,
    };
  }

  /**
   * Store a delta result using the new API
   *
   * Converts BestDeltaResult.delta (Uint8Array) to AsyncIterable
   * as expected by BlobDeltaApi.deltifyBlob.
   */
  private async storeDeltaResult(targetId: ObjectId, result: BestDeltaResult): Promise<void> {
    const deltaStream = toAsyncIterable(result.delta);
    await this.backend.delta.blobs.deltifyBlob(targetId, result.baseId, deltaStream);
  }

  /**
   * Remove unreachable blobs
   *
   * Walks from ref roots to find reachable blobs, then removes unreachable ones.
   */
  async collectGarbage(roots: ObjectId[], expire?: Date): Promise<GCResult> {
    const startTime = Date.now();
    const expireTime = expire?.getTime() ?? 0;

    const { blobs } = this.backend.structured;

    // Find all reachable blobs
    const reachable = new Set<string>();

    for (const root of roots) {
      await this.walkCommit(root, reachable);
    }

    // Count and potentially remove unreachable blobs
    let blobsRemoved = 0;
    let bytesFreed = 0;

    for await (const id of blobs.keys()) {
      if (reachable.has(id)) {
        continue;
      }

      // Check expiration if set
      if (expireTime > 0) {
        // Note: expiration check would require modification time tracking
        // which is not yet part of the BlobStore interface
      }

      // For now, just count - actual deletion would need additional API
      try {
        const size = await blobs.size(id);
        // NOTE: BlobStore doesn't have a delete method yet
        // This is tracked as a separate task
        blobsRemoved++;
        bytesFreed += size;
      } catch {
        // Skip inaccessible blobs
      }
    }

    return {
      blobsRemoved,
      bytesFreed,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Walk a commit and mark reachable objects
   */
  private async walkCommit(commitId: ObjectId, reachable: Set<string>): Promise<void> {
    if (reachable.has(commitId)) return;
    reachable.add(commitId);

    try {
      const commit = await this.backend.structured.commits.loadCommit(commitId);
      await this.walkTree(commit.tree, reachable);

      for (const parent of commit.parents) {
        await this.walkCommit(parent, reachable);
      }
    } catch {
      // Skip invalid commits
    }
  }

  /**
   * Walk a tree and mark reachable objects
   */
  private async walkTree(treeId: ObjectId, reachable: Set<string>): Promise<void> {
    if (reachable.has(treeId)) return;
    reachable.add(treeId);

    try {
      for await (const entry of this.backend.structured.trees.loadTree(treeId)) {
        reachable.add(entry.id);
        if (entry.mode === FileMode.TREE) {
          await this.walkTree(entry.id, reachable);
        }
      }
    } catch {
      // Skip invalid trees
    }
  }

  /**
   * Get time since last GC
   */
  getTimeSinceLastGC(): number {
    if (this.lastGC === 0) {
      return -1;
    }
    return Date.now() - this.lastGC;
  }

  /**
   * Get current options
   */
  getOptions(): Readonly<ResolvedGCOptions> {
    return { ...this.options };
  }
}

/**
 * Convert Uint8Array to AsyncIterable
 */
async function* toAsyncIterable(buffer: Uint8Array): AsyncIterable<Uint8Array> {
  yield buffer;
}
