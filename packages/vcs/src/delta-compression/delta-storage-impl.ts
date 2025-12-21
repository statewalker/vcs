/**
 * Delta Storage Implementation
 *
 * Coordinates binary storage (BinStore) with content-addressable operations
 * and delta compression strategies.
 */

import type { Delta } from "@webrun-vcs/utils";
import type {
  DeltaChainDetails,
  DeltaInfo,
  DeltaStore,
  RawStore,
} from "../binary-storage/index.js";
import type { VolatileStore } from "../binary-storage/volatile/index.js";
import {
  type GitObjectStore,
  GitObjectStoreImpl,
} from "../object-storage/git-codec/git-object-store.js";
import type { ObjectId, ObjectTypeString } from "../object-storage/interfaces/index.js";
import { objectExists, resolveDeltaChainToBytes } from "./resolve-delta-chain.js";
import type { DeltaCandidateStrategy, DeltaComputeOptions, DeltaComputeStrategy } from "./types.js";

/**
 * Default maximum chain depth for delta chains
 */
const DEFAULT_MAX_CHAIN_DEPTH = 10;

/**
 * Default maximum ratio for delta to be considered beneficial
 */
const DEFAULT_MAX_RATIO = 0.75;

/**
 * Delta storage options
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
 * Delta Storage Implementation
 *
 * Provides unified delta-aware object storage using the new architecture:
 * - BinStore for low-level storage (RawStore + DeltaStore)
 * - GitObjectStore for content-addressable operations
 * - Strategies for candidate selection and delta computation
 */
export class DeltaStorageImpl {
  /** Git object store for content-addressable operations */
  readonly gitObjects: GitObjectStore;

  readonly raw: RawStore;

  readonly delta: DeltaStore;

  private candidateStrategy: DeltaCandidateStrategy | undefined;
  private computeStrategy: DeltaComputeStrategy | undefined;
  private readonly maxChainDepth: number;
  private readonly maxRatio: number;

  constructor(
    raw: RawStore,
    delta: DeltaStore,
    readonly volatile: VolatileStore,
    options?: DeltaStorageOptions,
  ) {
    this.raw = raw;
    this.delta = delta;
    this.gitObjects = new GitObjectStoreImpl(volatile, this.raw);
    this.maxChainDepth = options?.maxChainDepth ?? DEFAULT_MAX_CHAIN_DEPTH;
    this.maxRatio = options?.maxRatio ?? DEFAULT_MAX_RATIO;
    this.candidateStrategy = options?.candidateStrategy;
    this.computeStrategy = options?.computeStrategy;
  }

  // ========== Content-Addressable Operations ==========

  /**
   * Store object content (content-addressable)
   *
   * Computes SHA-1 hash and stores via GitObjectStore.
   *
   * @param type Object type (blob, commit, tree, tag)
   * @param content Content stream
   * @returns Object ID (SHA-1 hash)
   */
  async store(type: ObjectTypeString, content: AsyncIterable<Uint8Array>): Promise<ObjectId> {
    return this.gitObjects.store(type, content);
  }

  /**
   * Load object content (streaming, resolves delta chains)
   *
   * Returns content with Git header stripped.
   * Transparently resolves delta chains if object is stored as delta.
   *
   * @param id Object ID
   * @throws Error if object not found
   */
  async *load(id: ObjectId): AsyncGenerator<Uint8Array> {
    // Check if it's a delta
    if (await this.delta.isDelta(id)) {
      // Resolve delta chain (strips header internally)
      yield* this.loadDeltaContent(id);
      return;
    }

    // Load from raw storage via GitObjectStore (strips header)
    yield* this.gitObjects.load(id);
  }

  /**
   * Load delta content, resolving chain
   *
   * Internal helper that handles delta resolution.
   */
  private async *loadDeltaContent(id: ObjectId): AsyncGenerator<Uint8Array> {
    // For deltas, we need to resolve the chain
    // The stored content is the delta instructions, not raw Git object
    const content = await resolveDeltaChainToBytes(id, this.raw, this.delta);
    yield content;
  }

  /**
   * Load raw object including Git header
   */
  async *loadRaw(id: ObjectId): AsyncGenerator<Uint8Array> {
    if (await this.delta.isDelta(id)) {
      // For deltas, reconstruct the full object with header
      const content = await resolveDeltaChainToBytes(id, this.raw, this.delta);
      const header = await this.gitObjects.getHeader(id);
      const encoder = new TextEncoder();
      yield encoder.encode(`${header.type} ${content.length}\0`);
      yield content;
      return;
    }

    yield* this.gitObjects.loadRaw(id);
  }

  /**
   * Get object size
   */
  async getSize(id: ObjectId): Promise<number> {
    // Check delta storage first
    const chainInfo = await this.delta.getDeltaChainInfo(id);
    if (chainInfo) {
      return chainInfo.originalSize;
    }

    // Get size from raw storage via header
    const header = await this.gitObjects.getHeader(id);
    return header.size;
  }

  /**
   * Check if object exists
   */
  async has(id: ObjectId): Promise<boolean> {
    return objectExists(id, this.raw, this.delta);
  }

  /**
   * Delete object
   */
  async delete(id: ObjectId): Promise<boolean> {
    let deleted = false;

    if (await this.delta.isDelta(id)) {
      deleted = await this.delta.removeDelta(id);
    }

    if (await this.raw.has(id)) {
      deleted = (await this.raw.delete(id)) || deleted;
    }

    return deleted;
  }

  /**
   * List all object IDs
   */
  async *listObjects(): AsyncGenerator<ObjectId> {
    const seen = new Set<ObjectId>();

    // From raw storage
    for await (const key of this.raw.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        yield key;
      }
    }

    // From delta storage
    for await (const info of this.delta.listDeltas()) {
      if (!seen.has(info.targetKey)) {
        seen.add(info.targetKey);
        yield info.targetKey;
      }
    }
  }

  // ========== Strategy Configuration ==========

  setCandidateStrategy(strategy: DeltaCandidateStrategy): void {
    this.candidateStrategy = strategy;
  }

  setComputeStrategy(strategy: DeltaComputeStrategy): void {
    this.computeStrategy = strategy;
  }

  getStrategies(): {
    candidate: DeltaCandidateStrategy | undefined;
    compute: DeltaComputeStrategy | undefined;
  } {
    return {
      candidate: this.candidateStrategy,
      compute: this.computeStrategy,
    };
  }

  // ========== Delta Operations ==========

  /**
   * Deltify an object using configured strategies
   */
  async deltify(targetId: ObjectId, options?: DeltaComputeOptions): Promise<boolean> {
    if (!this.candidateStrategy) {
      throw new Error("No candidate strategy configured");
    }

    if (await this.delta.isDelta(targetId)) {
      return false;
    }

    const candidateIds: ObjectId[] = [];
    for await (const candidateId of this.candidateStrategy.findCandidates(targetId, this)) {
      candidateIds.push(candidateId);
    }

    return this.deltifyWith(targetId, candidateIds, options);
  }

  /**
   * Deltify with explicit candidates
   */
  async deltifyWith(
    targetId: ObjectId,
    candidateIds: ObjectId[],
    options?: DeltaComputeOptions,
  ): Promise<boolean> {
    if (!this.computeStrategy) {
      throw new Error("No compute strategy configured");
    }

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
      delta: Delta[];
      ratio: number;
    } | null = null;

    for (const candidateId of candidateIds) {
      // Skip if would create deep chain
      const chainInfo = await this.delta.getDeltaChainInfo(candidateId);
      if (chainInfo && chainInfo.depth >= this.maxChainDepth - 1) {
        continue;
      }

      const baseContent = await this.loadFullContent(candidateId);
      if (!baseContent) {
        continue;
      }

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

    await this.storeDeltaFor(targetId, bestResult.baseId, bestResult.delta);
    return true;
  }

  /**
   * Convert delta back to full content
   */
  async undeltify(id: ObjectId): Promise<void> {
    if (!(await this.delta.isDelta(id))) {
      return;
    }

    // Load full content through delta resolution
    const content = await resolveDeltaChainToBytes(id, this.raw, this.delta);

    // Get header info to store with correct type
    // Note: we need to know the type, which requires looking at the base chain
    // For now, store as blob - this may need refinement
    await this.gitObjects.store(
      "blob",
      (async function* () {
        yield content;
      })(),
    );

    // Remove delta
    await this.delta.removeDelta(id);
  }

  /**
   * Check if object is stored as delta
   */
  async isDelta(id: ObjectId): Promise<boolean> {
    return this.delta.isDelta(id);
  }

  /**
   * Get delta chain information
   */
  async getDeltaChainInfo(id: ObjectId): Promise<DeltaChainDetails | undefined> {
    const info = await this.delta.getDeltaChainInfo(id);
    if (!info) return undefined;

    return {
      baseKey: info.baseKey,
      targetKey: info.targetKey,
      depth: info.depth,
      originalSize: info.originalSize,
      compressedSize: info.compressedSize,
      chain: info.chain,
    };
  }

  // ========== Direct Delta Operations ==========

  /**
   * Store delta (DeltaStore interface)
   */
  async storeDelta(info: DeltaInfo, delta: Delta[]): Promise<number> {
    return this.storeDeltaFor(info.targetKey, info.baseKey, delta);
  }

  /**
   * Store delta with known base
   */
  private async storeDeltaFor(
    targetId: ObjectId,
    baseId: ObjectId,
    delta: Delta[],
  ): Promise<number> {
    if (!(await this.has(baseId))) {
      throw new Error(`Base object ${baseId} not found`);
    }

    const baseChain = await this.delta.getDeltaChainInfo(baseId);
    if (baseChain && baseChain.depth >= this.maxChainDepth - 1) {
      throw new Error(
        `Storing delta would exceed max chain depth (${this.maxChainDepth}). ` +
          `Base ${baseId} is already at depth ${baseChain.depth}.`,
      );
    }

    const info: DeltaInfo = {
      baseKey: baseId,
      targetKey: targetId,
    };

    const result = await this.delta.storeDelta(info, delta);

    // Remove from raw storage if successfully stored as delta
    if (result && (await this.raw.has(targetId))) {
      await this.raw.delete(targetId);
    }

    return result;
  }

  /**
   * Load delta information
   */
  async loadDelta(
    id: ObjectId,
  ): Promise<{ baseKey: string; targetKey: string; delta: Delta[]; ratio: number } | undefined> {
    return this.delta.loadDelta(id);
  }

  /**
   * Remove delta relationship
   */
  async removeDelta(targetKey: string, keepAsBase?: boolean): Promise<boolean> {
    return this.delta.removeDelta(targetKey, keepAsBase);
  }

  /**
   * List all delta relationships
   */
  async *listDeltas(): AsyncIterable<DeltaInfo> {
    yield* this.delta.listDeltas();
  }

  // ========== Private Helpers ==========

  private async loadFullContent(id: ObjectId): Promise<Uint8Array | undefined> {
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of this.load(id)) {
        chunks.push(chunk);
      }
      return concatBytes(chunks);
    } catch {
      return undefined;
    }
  }
}

/**
 * Concatenate byte arrays
 */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0];

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
