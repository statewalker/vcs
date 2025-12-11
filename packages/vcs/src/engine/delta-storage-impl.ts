/**
 * Delta Storage Facade Implementation
 *
 * Coordinates loose object storage, delta backend, and strategies
 * to provide unified delta-aware storage.
 */

import type { Delta } from "@webrun-vcs/utils";
import type {
  DeltaCandidateStrategy,
  DeltaChainDetails,
  DeltaChainStore,
  DeltaChainStoreStats,
  DeltaComputeOptions,
  DeltaComputeStrategy,
  DeltaStorageManager,
  ObjectId,
  ObjectStore,
  PackingSuggestion,
  RepackOptions,
  RepackResult,
  RepositoryAnalysis,
  StoredDelta,
} from "../interfaces/index.js";
import { RollingHashDeltaStrategy } from "./strategies/rolling-hash-compute.js";
import { SimilarSizeCandidateStrategy } from "./strategies/similar-size-candidate.js";

/**
 * Default maximum chain depth for delta chains
 */
const DEFAULT_MAX_CHAIN_DEPTH = 10;

/**
 * Default window size for commit window strategy
 */
const DEFAULT_WINDOW_SIZE = 10;

/**
 * Default maximum ratio for delta to be considered beneficial
 */
const DEFAULT_MAX_RATIO = 0.75;

/**
 * Delta storage facade options
 */
export interface DeltaStorageOptions {
  /** Maximum delta chain depth */
  maxChainDepth?: number;
  /** Default max ratio for deltification */
  maxRatio?: number;
  /** Initial candidate strategy */
  candidateStrategy?: DeltaCandidateStrategy;
  /** Initial compute strategy */
  computeStrategy?: DeltaComputeStrategy;
}

/**
 * Delta Storage implementation
 *
 * Provides a unified interface for delta-aware object storage,
 * coordinating between loose storage and delta backend.
 */
export class DeltaStorageImpl implements DeltaStorageManager {
  readonly looseStorage: ObjectStore;
  readonly deltaBackend: DeltaChainStore;

  private candidateStrategy: DeltaCandidateStrategy;
  private computeStrategy: DeltaComputeStrategy;
  private readonly maxChainDepth: number;
  private readonly maxRatio: number;

  constructor(
    looseStorage: ObjectStore,
    deltaBackend: DeltaChainStore,
    options?: DeltaStorageOptions,
  ) {
    this.looseStorage = looseStorage;
    this.deltaBackend = deltaBackend;
    this.maxChainDepth = options?.maxChainDepth ?? DEFAULT_MAX_CHAIN_DEPTH;
    this.maxRatio = options?.maxRatio ?? DEFAULT_MAX_RATIO;

    // Default strategies
    this.candidateStrategy =
      options?.candidateStrategy ?? new SimilarSizeCandidateStrategy({ maxCandidates: 10 });
    this.computeStrategy = options?.computeStrategy ?? new RollingHashDeltaStrategy();
  }

  // ========== ObjectStore Interface ==========

  async store(data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId> {
    // Store as loose object first
    return this.looseStorage.store(data);
  }

  async *load(
    id: ObjectId,
    params?: { offset?: number; length?: number },
  ): AsyncIterable<Uint8Array> {
    // Try delta backend first
    const content = await this.deltaBackend.loadObject(id);
    if (content) {
      const offset = params?.offset ?? 0;
      const length = params?.length ?? content.length - offset;
      yield content.subarray(offset, offset + length);
      return;
    }

    // Fall back to loose storage
    yield* this.looseStorage.load(id, params);
  }

  async getSize(id: ObjectId): Promise<number> {
    // Check delta backend first
    if (await this.deltaBackend.has(id)) {
      const chainInfo = await this.deltaBackend.getDeltaChainInfo(id);
      if (chainInfo) {
        return chainInfo.originalSize;
      }
    }

    // Fall back to loose storage
    return this.looseStorage.getSize(id);
  }

  async has(id: ObjectId): Promise<boolean> {
    // Check both storages
    if (await this.deltaBackend.has(id)) {
      return true;
    }
    return this.looseStorage.has(id);
  }

  async delete(id: ObjectId): Promise<boolean> {
    // Delete from both storages
    let deleted = false;

    if (await this.deltaBackend.isDelta(id)) {
      deleted = await this.deltaBackend.removeDelta(id);
    }

    if (await this.looseStorage.has(id)) {
      deleted = (await this.looseStorage.delete(id)) || deleted;
    }

    return deleted;
  }

  async *listObjects(): AsyncGenerator<ObjectId> {
    const seen = new Set<ObjectId>();

    // List objects from delta backend
    for await (const id of this.deltaBackend.listObjects()) {
      if (!seen.has(id)) {
        seen.add(id);
        yield id;
      }
    }

    // List objects from loose storage
    if (this.looseStorage.listObjects) {
      for await (const id of this.looseStorage.listObjects()) {
        if (!seen.has(id)) {
          seen.add(id);
          yield id;
        }
      }
    }
  }

  // ========== Configuration ==========

  setCandidateStrategy(strategy: DeltaCandidateStrategy): void {
    this.candidateStrategy = strategy;
  }

  setComputeStrategy(strategy: DeltaComputeStrategy): void {
    this.computeStrategy = strategy;
  }

  getStrategies(): { candidate: DeltaCandidateStrategy; compute: DeltaComputeStrategy } {
    return {
      candidate: this.candidateStrategy,
      compute: this.computeStrategy,
    };
  }

  // ========== Delta Operations ==========

  async deltify(targetId: ObjectId, options?: DeltaComputeOptions): Promise<boolean> {
    // Check if already a delta
    if (await this.deltaBackend.isDelta(targetId)) {
      return false;
    }

    // Find candidates using strategy
    const candidateIds: ObjectId[] = [];
    for await (const candidateId of this.candidateStrategy.findCandidates(
      targetId,
      this.looseStorage,
    )) {
      candidateIds.push(candidateId);
    }

    return this.deltifyWith(targetId, candidateIds, options);
  }

  async deltifyWith(
    targetId: ObjectId,
    candidateIds: ObjectId[],
    options?: DeltaComputeOptions,
  ): Promise<boolean> {
    if (candidateIds.length === 0) {
      return false;
    }

    // Load target content
    const targetContent = await this.loadFullContent(targetId);
    if (!targetContent) {
      return false;
    }

    const computeOptions = {
      maxRatio: this.maxRatio,
      ...options,
    };

    let bestResult: {
      baseId: ObjectId;
      delta: import("@webrun-vcs/utils").Delta[];
      ratio: number;
    } | null = null;

    // Try each candidate
    for (const candidateId of candidateIds) {
      // Skip if this would create a deep chain
      const chainInfo = await this.deltaBackend.getDeltaChainInfo(candidateId);
      if (chainInfo && chainInfo.depth >= this.maxChainDepth - 1) {
        continue;
      }

      // Load base content
      const baseContent = await this.loadFullContent(candidateId);
      if (!baseContent) {
        continue;
      }

      // Compute delta
      const result = this.computeStrategy.computeDelta(baseContent, targetContent, computeOptions);

      if (result && (!bestResult || result.ratio < bestResult.ratio)) {
        bestResult = {
          baseId: candidateId,
          delta: result.delta,
          ratio: result.ratio,
        };
      }
    }

    if (!bestResult) {
      return false;
    }

    // Store the delta
    return this.deltaBackend.storeDelta(targetId, bestResult.baseId, bestResult.delta);
  }

  async undeltify(id: ObjectId): Promise<void> {
    if (!(await this.deltaBackend.isDelta(id))) {
      return;
    }

    // Load full content through delta chain resolution
    const content = await this.deltaBackend.loadObject(id);
    if (!content) {
      throw new Error(`Failed to resolve delta for ${id}`);
    }

    // Store as loose object
    await this.looseStorage.store([content]);

    // Remove delta
    await this.deltaBackend.removeDelta(id);
  }

  async isDelta(id: ObjectId): Promise<boolean> {
    return this.deltaBackend.isDelta(id);
  }

  async getDeltaChainInfo(id: ObjectId): Promise<DeltaChainDetails | undefined> {
    return this.deltaBackend.getDeltaChainInfo(id);
  }

  // ========== Direct Delta Operations ==========

  async storeDelta(targetId: ObjectId, baseId: ObjectId, delta: Delta[]): Promise<boolean> {
    // Verify base exists
    if (!(await this.has(baseId))) {
      throw new Error(`Base object ${baseId} not found`);
    }

    // Check if storing as delta would exceed chain depth
    const baseChain = await this.deltaBackend.getDeltaChainInfo(baseId);
    if (baseChain && baseChain.depth >= this.maxChainDepth - 1) {
      throw new Error(
        `Storing delta would exceed max chain depth (${this.maxChainDepth}). ` +
          `Base ${baseId} is already at depth ${baseChain.depth}.`,
      );
    }

    // Store via backend
    const result = await this.deltaBackend.storeDelta(targetId, baseId, delta);

    // Remove from loose storage if successfully stored as delta
    if (result && (await this.looseStorage.has(targetId))) {
      await this.looseStorage.delete(targetId);
    }

    return result;
  }

  async loadDelta(id: ObjectId): Promise<StoredDelta | undefined> {
    return this.deltaBackend.loadDelta(id);
  }

  // ========== Analysis & Maintenance ==========

  async analyzeRepository(): Promise<RepositoryAnalysis> {
    let totalObjects = 0;
    let looseObjects = 0;
    let deltaObjects = 0;
    let totalSize = 0;
    let compressedSize = 0;
    let totalDepth = 0;
    let deepChains = 0;

    const backendStats = await this.deltaBackend.getStats();
    deltaObjects = backendStats.deltaCount;
    totalDepth = backendStats.averageChainDepth * deltaObjects;

    if (backendStats.maxChainDepth > this.maxChainDepth) {
      deepChains = 1; // At least one deep chain exists
    }

    // Count loose objects
    if (this.looseStorage.listObjects) {
      for await (const id of this.looseStorage.listObjects()) {
        looseObjects++;
        const size = await this.looseStorage.getSize(id);
        if (size > 0) {
          totalSize += size;
          compressedSize += size; // Loose objects are not compressed in this metric
        }
      }
    }

    totalObjects = looseObjects + deltaObjects;
    compressedSize += backendStats.totalSize;

    // Estimate potential savings (simplified)
    const potentialSavings = Math.floor(totalSize * 0.3); // Assume 30% potential savings
    const deltifiableCandidates = looseObjects;

    return {
      totalObjects,
      looseObjects,
      deltaObjects,
      totalSize,
      compressedSize,
      potentialSavings,
      deltifiableCandidates,
      averageChainDepth: backendStats.deltaCount > 0 ? totalDepth / backendStats.deltaCount : 0,
      deepChains,
    };
  }

  async suggestPacking(_options?: { commitScope?: ObjectId }): Promise<PackingSuggestion> {
    const candidates: PackingSuggestion["candidates"] = [];
    let estimatedSavings = 0;
    const chainsToBreak: ObjectId[] = [];

    // Find objects that are not deltas
    if (this.looseStorage.listObjects) {
      for await (const id of this.looseStorage.listObjects()) {
        if (await this.deltaBackend.isDelta(id)) {
          continue;
        }

        // Find potential bases
        const suggestedBases: ObjectId[] = [];
        for await (const baseId of this.candidateStrategy.findCandidates(id, this.looseStorage)) {
          suggestedBases.push(baseId);
          if (suggestedBases.length >= 3) break;
        }

        if (suggestedBases.length > 0) {
          candidates.push({
            targetId: id,
            suggestedBases,
            estimatedRatio: 0.5, // Rough estimate
          });
          const size = await this.looseStorage.getSize(id);
          estimatedSavings += size * 0.5;
        }
      }
    }

    // Find chains that are too deep
    for await (const { targetId } of this.deltaBackend.listDeltas()) {
      const chainInfo = await this.deltaBackend.getDeltaChainInfo(targetId);
      if (chainInfo && chainInfo.depth > this.maxChainDepth) {
        chainsToBreak.push(targetId);
      }
    }

    return {
      candidates,
      estimatedSavings,
      chainsToBreak,
    };
  }

  async repack(options?: RepackOptions): Promise<RepackResult> {
    const startTime = Date.now();
    const maxChainDepth = options?.maxChainDepth ?? this.maxChainDepth;
    const windowSize = options?.windowSize ?? DEFAULT_WINDOW_SIZE;
    let objectsProcessed = 0;
    let deltasCreated = 0;
    let deltasRemoved = 0;
    let looseObjectsPruned = 0;
    let spaceSaved = 0;

    // Phase 1: Break deep chains
    if (options?.onProgress) {
      options.onProgress("breaking-chains", 0, 1);
    }

    for await (const { targetId } of this.deltaBackend.listDeltas()) {
      const chainInfo = await this.deltaBackend.getDeltaChainInfo(targetId);
      if (chainInfo && chainInfo.depth > maxChainDepth) {
        await this.undeltify(targetId);
        deltasRemoved++;
      }
    }

    // Phase 2: Deltify loose objects
    const looseIds: ObjectId[] = [];
    if (this.looseStorage.listObjects) {
      for await (const id of this.looseStorage.listObjects()) {
        if (!(await this.deltaBackend.isDelta(id))) {
          looseIds.push(id);
        }
      }
    }

    const total = looseIds.length;
    for (let i = 0; i < looseIds.length; i++) {
      if (options?.onProgress) {
        options.onProgress("deltifying", i, total);
      }

      const id = looseIds[i];

      // Get candidates from window
      const windowStart = Math.max(0, i - windowSize);
      const candidates = looseIds.slice(windowStart, i);

      if (await this.deltifyWith(id, candidates, { maxRatio: this.maxRatio })) {
        deltasCreated++;
        const size = await this.looseStorage.getSize(id);
        spaceSaved += size * 0.5; // Rough estimate
      }

      objectsProcessed++;
    }

    // Phase 3: Prune loose objects
    if (options?.pruneLoose) {
      if (options?.onProgress) {
        options.onProgress("pruning", 0, 1);
      }
      looseObjectsPruned = await this.pruneLooseObjects();
    }

    return {
      objectsProcessed,
      deltasCreated,
      deltasRemoved,
      looseObjectsPruned,
      spaceSaved,
      duration: Date.now() - startTime,
    };
  }

  async quickPack(commitId: ObjectId): Promise<number> {
    // Use commit window strategy to find related objects
    let deltified = 0;

    // This is a simplified implementation
    // A real implementation would traverse the commit tree

    const candidates: ObjectId[] = [];
    for await (const id of this.candidateStrategy.findCandidates(commitId, this.looseStorage)) {
      candidates.push(id);
    }

    if (await this.deltifyWith(commitId, candidates)) {
      deltified++;
    }

    return deltified;
  }

  async pruneLooseObjects(): Promise<number> {
    let pruned = 0;

    if (!this.looseStorage.listObjects) {
      return 0;
    }

    const looseIds: ObjectId[] = [];
    for await (const id of this.looseStorage.listObjects()) {
      looseIds.push(id);
    }

    for (const id of looseIds) {
      // If object is stored as delta, we can prune the loose copy
      if (await this.deltaBackend.isDelta(id)) {
        await this.looseStorage.delete(id);
        pruned++;
      }
    }

    return pruned;
  }

  // ========== Stats ==========

  async getStats(): Promise<{
    loose: { count: number; size: number };
    delta: DeltaChainStoreStats;
  }> {
    let looseCount = 0;
    let looseSize = 0;

    if (this.looseStorage.listObjects) {
      for await (const id of this.looseStorage.listObjects()) {
        looseCount++;
        const size = await this.looseStorage.getSize(id);
        if (size > 0) {
          looseSize += size;
        }
      }
    }

    const deltaStats = await this.deltaBackend.getStats();

    return {
      loose: {
        count: looseCount,
        size: looseSize,
      },
      delta: deltaStats,
    };
  }

  // ========== Private Helpers ==========

  /**
   * Load full content of an object
   */
  private async loadFullContent(id: ObjectId): Promise<Uint8Array | undefined> {
    // Try delta backend first
    const deltaContent = await this.deltaBackend.loadObject(id);
    if (deltaContent) {
      return deltaContent;
    }

    // Fall back to loose storage
    const chunks: Uint8Array[] = [];
    try {
      for await (const chunk of this.looseStorage.load(id)) {
        chunks.push(chunk);
      }
    } catch {
      return undefined;
    }

    if (chunks.length === 0) {
      return undefined;
    }

    // Concatenate chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }
}
