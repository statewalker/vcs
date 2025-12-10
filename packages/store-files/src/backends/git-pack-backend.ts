/**
 * Git Pack Backend implementing the DeltaChainStore interface
 *
 * This provides a DeltaChainStore implementation that stores objects
 * in Git pack files, using the new strategy-based delta architecture.
 *
 * Key differences from GitDeltaObjectStorage:
 * - Implements DeltaChainStore interface (not DeltaObjectStore)
 * - Works with Delta[] arrays (format-agnostic)
 * - Handles serialization to Git binary format internally
 * - Designed for composition with DeltaStorageManager facade
 *
 * Note: Since Git pack files don't store raw delta data accessibly after
 * resolution, the loadDelta method works with pending deltas only.
 * For pack storage, we track delta relationships but the actual delta
 * data is resolved by PackReader.
 */

import type { FilesApi } from "@statewalker/webrun-files";
import {
  applyDelta as applyDeltaInternal,
  type Delta,
  serializeDeltaToGit,
} from "@webrun-vcs/utils";
import type {
  DeltaChainDetails,
  DeltaChainStore,
  DeltaChainStoreStats,
  ObjectId,
  StoredDelta,
} from "@webrun-vcs/vcs";
import { parseObjectHeader } from "../format/object-header.js";
import { GitPackStorage } from "../git-pack-storage.js";
import { PackWriterStream, writePackIndex } from "../pack/index.js";
import { PackObjectType } from "../pack/types.js";
import { atomicWriteFile, bytesToHex, concatBytes, ensureDir } from "../utils/index.js";

/**
 * Git Pack Backend for delta storage
 *
 * Stores deltas in Git pack files using OFS_DELTA or REF_DELTA format.
 * Implements the DeltaChainStore interface for use with DeltaStorageManager facade.
 */
export class GitPackBackend implements DeltaChainStore {
  readonly name = "git-pack";

  private readonly files: FilesApi;
  private readonly gitDir: string;
  private readonly packStorage: GitPackStorage;

  /** Pending deltas to write in next flush */
  private pendingDeltas: Map<
    ObjectId,
    { baseId: ObjectId; delta: Uint8Array; deltaArray: Delta[] }
  > = new Map();

  /** Pending base objects to write */
  private pendingBases: Map<ObjectId, { type: PackObjectType; content: Uint8Array }> = new Map();

  constructor(files: FilesApi, gitDir: string) {
    this.files = files;
    this.gitDir = gitDir;
    this.packStorage = new GitPackStorage(files, gitDir);
  }

  /**
   * Store a delta relationship
   *
   * Converts Delta[] to Git binary format and queues for pack file creation.
   * Call flush() to write pending deltas to a pack file.
   */
  async storeDelta(targetId: ObjectId, baseId: ObjectId, delta: Delta[]): Promise<boolean> {
    try {
      // Serialize Delta[] to Git binary format
      const gitDelta = serializeDeltaToGit(delta);

      // Queue for writing (store both binary and Delta[] for loadDelta)
      this.pendingDeltas.set(targetId, { baseId, delta: gitDelta, deltaArray: delta });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load delta for an object
   *
   * For pending deltas, returns the stored Delta[].
   * For pack storage deltas, we can identify it's a delta but the raw
   * delta data is not directly accessible (PackReader resolves it).
   */
  async loadDelta(id: ObjectId): Promise<StoredDelta | undefined> {
    // Check pending first - these have Delta[] stored
    const pending = this.pendingDeltas.get(id);
    if (pending) {
      return {
        targetId: id,
        baseId: pending.baseId,
        delta: pending.deltaArray,
        ratio: pending.delta.length / this.estimateTargetSize(pending.deltaArray),
      };
    }

    // For pack storage, we can only check if it's a delta
    // The actual delta data has been resolved by PackReader
    const chainInfo = await this.packStorage.getDeltaChainInfo(id);
    if (!chainInfo) {
      return undefined;
    }

    // Return minimal info - delta data is not directly accessible from packs
    // The content has already been resolved
    return {
      targetId: id,
      baseId: chainInfo.baseId,
      delta: [], // Empty - delta was resolved by pack reader
      ratio: 0,
    };
  }

  /**
   * Check if object is stored as delta
   */
  async isDelta(id: ObjectId): Promise<boolean> {
    // Check pending
    if (this.pendingDeltas.has(id)) {
      return true;
    }

    // Check pack storage
    return this.packStorage.isDelta(id);
  }

  /**
   * Check if object exists in backend
   */
  async has(id: ObjectId): Promise<boolean> {
    return (
      this.pendingDeltas.has(id) || this.pendingBases.has(id) || (await this.packStorage.has(id))
    );
  }

  /**
   * Load full object content (resolving delta chain)
   */
  async loadObject(id: ObjectId): Promise<Uint8Array | undefined> {
    // Check pending bases first
    const pendingBase = this.pendingBases.get(id);
    if (pendingBase) {
      return pendingBase.content;
    }

    // For pending deltas, resolve using stored Delta[]
    const pendingDelta = this.pendingDeltas.get(id);
    if (pendingDelta) {
      // Load base content
      const baseContent = await this.loadObject(pendingDelta.baseId);
      if (!baseContent) {
        return undefined;
      }

      // Apply delta using the stored Delta[]
      return this.applyDeltaArray(baseContent, pendingDelta.deltaArray);
    }

    // Load from pack storage (returns raw Git object with header)
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of this.packStorage.load(id)) {
        chunks.push(chunk);
      }
      if (chunks.length === 0) {
        return undefined;
      }

      const fullData = concatBytes(...chunks);

      // Parse Git object header to get content without header
      const header = parseObjectHeader(fullData);
      return fullData.subarray(header.contentOffset);
    } catch {
      return undefined;
    }
  }

  /**
   * Remove delta relationship
   *
   * For Git pack files, this is tricky since packs are immutable.
   * If keepAsBase is true, we write the full object to a new pack.
   */
  async removeDelta(id: ObjectId, keepAsBase = false): Promise<boolean> {
    // Remove from pending
    if (this.pendingDeltas.has(id)) {
      if (keepAsBase) {
        const content = await this.loadObject(id);
        if (content) {
          this.pendingBases.set(id, { type: PackObjectType.BLOB, content });
        }
      }
      this.pendingDeltas.delete(id);
      return true;
    }

    // For pack storage, we can't really remove - just note it
    // The object will remain until a full repack
    if (keepAsBase) {
      const content = await this.loadObject(id);
      if (content) {
        this.pendingBases.set(id, { type: PackObjectType.BLOB, content });
        return true;
      }
    }

    return false;
  }

  /**
   * Get delta chain info
   */
  async getDeltaChainInfo(id: ObjectId): Promise<DeltaChainDetails | undefined> {
    // Check pending
    const pending = this.pendingDeltas.get(id);
    if (pending) {
      const baseChain = await this.getDeltaChainInfo(pending.baseId);
      return {
        baseId: baseChain?.baseId ?? pending.baseId,
        depth: (baseChain?.depth ?? 0) + 1,
        originalSize: 0, // Unknown for pending
        compressedSize: pending.delta.length,
        chain: [id, ...(baseChain?.chain ?? [pending.baseId])],
      };
    }

    // Check pack storage
    const chainInfo = await this.packStorage.getDeltaChainInfo(id);
    if (!chainInfo) {
      return undefined;
    }

    return {
      baseId: chainInfo.baseId,
      depth: chainInfo.depth,
      originalSize: 0, // Would need to calculate
      compressedSize: chainInfo.savings, // Approximation
      chain: [id], // Pack storage doesn't return full chain
    };
  }

  /**
   * List all objects
   */
  async *listObjects(): AsyncIterable<ObjectId> {
    // Yield pending objects
    for (const id of this.pendingDeltas.keys()) {
      yield id;
    }
    for (const id of this.pendingBases.keys()) {
      yield id;
    }

    // Yield from pack storage
    const seen = new Set([...this.pendingDeltas.keys(), ...this.pendingBases.keys()]);
    for await (const id of this.packStorage.listObjects()) {
      if (!seen.has(id)) {
        yield id;
      }
    }
  }

  /**
   * List only delta objects
   */
  async *listDeltas(): AsyncIterable<{ targetId: ObjectId; baseId: ObjectId }> {
    // Pending deltas
    for (const [targetId, { baseId }] of this.pendingDeltas) {
      yield { targetId, baseId };
    }

    // Pack storage deltas
    for await (const id of this.packStorage.listObjects()) {
      if (await this.packStorage.isDelta(id)) {
        const chainInfo = await this.packStorage.getDeltaChainInfo(id);
        if (chainInfo) {
          yield { targetId: id, baseId: chainInfo.baseId };
        }
      }
    }
  }

  /**
   * Get backend statistics
   */
  async getStats(): Promise<DeltaChainStoreStats> {
    let deltaCount = this.pendingDeltas.size;
    let baseCount = this.pendingBases.size;
    let totalSize = 0;
    let totalDepth = 0;
    let maxChainDepth = 0;

    // Calculate pending sizes
    for (const { delta } of this.pendingDeltas.values()) {
      totalSize += delta.length;
    }
    for (const { content } of this.pendingBases.values()) {
      totalSize += content.length;
    }

    // Calculate from pack storage
    for await (const id of this.packStorage.listObjects()) {
      if (await this.packStorage.isDelta(id)) {
        deltaCount++;
        const chain = await this.packStorage.getDeltaChainInfo(id);
        if (chain) {
          totalDepth += chain.depth;
          maxChainDepth = Math.max(maxChainDepth, chain.depth);
        }
      } else {
        baseCount++;
      }
    }

    return {
      deltaCount,
      baseCount,
      averageChainDepth: deltaCount > 0 ? totalDepth / deltaCount : 0,
      maxChainDepth,
      totalSize,
      extra: {
        pendingDeltas: this.pendingDeltas.size,
        pendingBases: this.pendingBases.size,
      },
    };
  }

  /**
   * Flush pending writes to pack files
   */
  async flush(): Promise<void> {
    if (this.pendingDeltas.size === 0 && this.pendingBases.size === 0) {
      return;
    }

    const packStream = new PackWriterStream();

    // Write base objects first
    for (const [id, { type, content }] of this.pendingBases) {
      await packStream.addObject(id, type, content);
    }

    // Write deltas using REF_DELTA (base can be in any pack)
    for (const [targetId, { baseId, delta }] of this.pendingDeltas) {
      await packStream.addRefDelta(targetId, baseId, delta);
    }

    const result = await packStream.finalize();

    // Write pack and index files
    const packName = bytesToHex(result.packChecksum);
    const packDir = `${this.gitDir}/objects/pack`;
    const packPath = `${packDir}/pack-${packName}.pack`;
    const idxPath = `${packDir}/pack-${packName}.idx`;

    await ensureDir(this.files, packDir);
    await atomicWriteFile(this.files, packPath, result.packData);
    const indexData = await writePackIndex(result.indexEntries, result.packChecksum);
    await atomicWriteFile(this.files, idxPath, indexData);

    // Clear pending and refresh
    this.pendingDeltas.clear();
    this.pendingBases.clear();
    await this.packStorage.refresh();
  }

  /**
   * Close backend
   */
  async close(): Promise<void> {
    await this.flush();
    await this.packStorage.close();
  }

  /**
   * Refresh backend state
   */
  async refresh(): Promise<void> {
    await this.packStorage.refresh();
  }

  /**
   * Store a base object (non-delta)
   */
  async storeObject(
    id: ObjectId,
    content: Uint8Array,
    type: PackObjectType = PackObjectType.BLOB,
  ): Promise<void> {
    this.pendingBases.set(id, { type, content });
  }

  // ========== Private Helpers ==========

  private estimateTargetSize(delta: Delta[]): number {
    for (const d of delta) {
      if (d.type === "start") {
        return d.targetLen;
      }
    }
    return 0;
  }

  private applyDeltaArray(base: Uint8Array, delta: Delta[]): Uint8Array {
    // Use the applyDelta from @webrun-vcs/diff
    const chunks: Uint8Array[] = [];
    for (const chunk of applyDeltaInternal(base, delta)) {
      chunks.push(chunk);
    }
    return concatBytes(...chunks);
  }
}
