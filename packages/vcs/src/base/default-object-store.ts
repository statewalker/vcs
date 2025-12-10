/**
 * Default object storage with delta compression support
 *
 * Implements content-addressable storage with Fossil-style delta compression,
 * following the repository pattern for clean separation of concerns.
 */

import {
  applyDelta,
  bytesToHex,
  compressBlock,
  createDelta,
  createFossilLikeRanges,
  decodeDeltaBlocks,
  decompressBlock,
  encodeDeltaBlocks,
  newSha1,
} from "@webrun-vcs/utils";
import type {
  DeltaChainInfo,
  DeltaObjectStore,
  DeltaOptions,
  ObjectId,
} from "../interfaces/index.js";
import type { IntermediateCache } from "./intermediate-cache.js";
import type { LRUCache } from "./lru-cache.js";
import type { DeltaRepository } from "./repositories/delta-repository.js";
import type { MetadataRepository } from "./repositories/metadata-repository.js";
import type { ObjectRepository } from "./repositories/object-repository.js";

/**
 * Default object storage with delta compression
 *
 * Orchestrates repositories and caches to provide efficient object storage
 * with transparent delta compression and reconstruction.
 */
export class DefaultObjectStore implements DeltaObjectStore {
  constructor(
    private objectRepo: ObjectRepository,
    private deltaRepo: DeltaRepository,
    private metadataRepo: MetadataRepository,
    private contentCache: LRUCache<ObjectId, Uint8Array>,
    private intermediateCache: IntermediateCache,
  ) {}

  /**
   * Store object content
   */
  async store(data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId> {
    // Collect all chunks into a single buffer
    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    // Handle both sync and async iterables
    if (Symbol.asyncIterator in data) {
      for await (const chunk of data as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
        totalSize += chunk.length;
      }
    } else {
      for (const chunk of data as Iterable<Uint8Array>) {
        chunks.push(chunk);
        totalSize += chunk.length;
      }
    }

    // Combine into single array
    const content = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      content.set(chunk, offset);
      offset += chunk.length;
    }

    // Compute hash using configured algorithm
    const id = bytesToHex(newSha1(content));
    // crypto.hash(this.hashAlgorithm, content);
    const size = content.length;

    // Check for existing object
    if (await this.objectRepo.hasObject(id)) {
      return id;
    }

    // Compress with deflate (ZLIB format)
    const compressed = await compressBlock(content, { raw: false });

    // Store as full content initially
    await this.objectRepo.storeObject({
      id,
      size,
      content: compressed,
      created: Date.now(),
      accessed: Date.now(),
    });

    // Update metadata
    await this.metadataRepo.updateSize(id, compressed.length);

    return id;
  }

  /**
   * Load object content
   */
  async *load(
    id: ObjectId,
    params?: { offset?: number; length?: number },
  ): AsyncIterable<Uint8Array> {
    // Get full content first (from cache or storage)
    let content: Uint8Array;

    // Check LRU cache first
    if (this.contentCache.has(id)) {
      await this.metadataRepo.recordAccess(id);
      const cached = this.contentCache.get(id);
      if (cached) {
        content = cached;
      } else {
        content = await this.loadFullContent(id);
      }
    } else {
      content = await this.loadFullContent(id);
    }

    // Apply offset and length if specified
    const offset = params?.offset ?? 0;
    const length = params?.length ?? content.length - offset;
    const end = Math.min(offset + length, content.length);

    if (offset >= content.length) {
      // Offset beyond content - yield empty
      return;
    }

    yield content.subarray(offset, end);
  }

  /**
   * Load full content from storage (helper for load())
   */
  private async loadFullContent(id: ObjectId): Promise<Uint8Array> {
    // Get object entry from repository
    const entry = await this.objectRepo.loadObjectEntry(id);
    if (!entry) {
      throw new Error(`Object ${id} not found`);
    }

    // Update access metadata
    await this.metadataRepo.recordAccess(id);

    // Check if this is a delta
    const deltaInfo = await this.deltaRepo.get(entry.recordId);

    let content: Uint8Array;
    if (!deltaInfo) {
      // Full content - decompress and return
      content = await decompressBlock(entry.content, { raw: false });
    } else {
      // Delta content - reconstruct from chain
      content = await this.reconstructFromDelta(entry.recordId);
    }

    this.contentCache.set(id, content);
    return content;
  }

  /**
   * Get object size
   */
  async getSize(id: ObjectId): Promise<number> {
    const entry = await this.objectRepo.loadObjectEntry(id);
    if (!entry) return -1;
    return entry.size;
  }

  /**
   * Check if object exists
   */
  async has(id: ObjectId): Promise<boolean> {
    return this.objectRepo.hasObject(id);
  }

  /**
   * Delete object
   */
  async delete(id: ObjectId): Promise<boolean> {
    const entry = await this.objectRepo.loadObjectEntry(id);
    if (!entry) {
      return false;
    }

    // Check if any objects depend on this one
    const hasDeps = await this.deltaRepo.hasDependents(entry.recordId);
    if (hasDeps) {
      throw new Error(`Cannot delete object ${id}: other objects depend on it`);
    }

    // Delete delta relationship if exists
    await this.deltaRepo.delete(entry.recordId);

    // Delete from object repository
    const deleted = await this.objectRepo.deleteObject(id);

    // Clear caches
    this.contentCache.delete(id);
    this.intermediateCache.clear(entry.recordId);

    return deleted;
  }

  /**
   * Deltify object against candidate bases
   */
  async deltify(
    targetId: ObjectId,
    candidateIds: ObjectId[],
    options?: DeltaOptions,
  ): Promise<boolean> {
    const minSize = options?.minSize ?? 50;
    const minCompressionRatio = options?.minCompressionRatio ?? 0.75;

    // Get target object
    const targetEntry = await this.objectRepo.loadObjectEntry(targetId);
    if (!targetEntry) {
      throw new Error(`Target object ${targetId} not found`);
    }

    // Rule 1: Content must be at least 50 bytes
    if (targetEntry.size < minSize) {
      return false;
    }

    // Get decompressed target content
    const targetContent = await decompressBlock(targetEntry.content, { raw: false });

    let bestCandidateEntry = null;
    let bestDelta: Uint8Array | null = null;
    let bestSize = targetEntry.content.length; // Current compressed size

    // Try each candidate
    for (const candidateId of candidateIds) {
      const candidateEntry = await this.objectRepo.loadObjectEntry(candidateId);
      if (!candidateEntry) continue;

      // Rule 2: Base must be at least 50 bytes
      if (candidateEntry.size < minSize) continue;

      // Rule 3: Prevent circular dependencies
      const wouldCycle = await this.deltaRepo.wouldCreateCycle(
        targetEntry.recordId,
        candidateEntry.recordId,
      );
      if (wouldCycle) {
        continue;
      }

      // Get decompressed candidate content (may need reconstruction if it's a delta)
      const candidateIsObject = !(await this.deltaRepo.has(candidateEntry.recordId));
      let candidateContent: Uint8Array;
      if (candidateIsObject) {
        // Candidate is a full object - decompress it
        candidateContent = await decompressBlock(candidateEntry.content, { raw: false });
      } else {
        // Candidate is itself a delta - reconstruct it
        candidateContent = await this.reconstructFromDelta(candidateEntry.recordId);
      }

      // Create delta
      const deltaRanges = Array.from(createFossilLikeRanges(candidateContent, targetContent));
      const deltaCommands = createDelta(candidateContent, targetContent, deltaRanges);

      // Encode delta to bytes
      const deltaChunks = Array.from(encodeDeltaBlocks(deltaCommands));
      const deltaBytes = this.concatArrays(deltaChunks);

      // Compress delta bytes (like we do for full objects)
      const compressedDelta = await compressBlock(deltaBytes, { raw: false });

      // Rule 4: Delta must achieve at least 25% compression
      // Compare compressed delta size against compressed target size
      const compressionRatio = compressedDelta.length / targetEntry.content.length;
      if (compressionRatio >= minCompressionRatio) {
        continue; // Less than 25% compression
      }

      // Rule 5: Delta must be smaller than current storage (compressed)
      if (compressedDelta.length < bestSize) {
        bestCandidateEntry = candidateEntry;
        bestDelta = compressedDelta;
        bestSize = compressedDelta.length;
      }
    }

    // If we found a good delta, apply it
    if (bestCandidateEntry && bestDelta) {
      // Update object content
      await this.objectRepo.storeObject({
        id: targetEntry.id,
        size: targetEntry.size,
        content: bestDelta,
        created: targetEntry.created,
        accessed: Date.now(),
      });

      // Create delta relationship
      await this.deltaRepo.set({
        objectRecordId: targetEntry.recordId,
        baseRecordId: bestCandidateEntry.recordId,
        deltaSize: bestDelta.length,
      });

      // Invalidate caches
      this.contentCache.delete(targetId);
      this.intermediateCache.clear(targetEntry.recordId);

      return true;
    }

    return false;
  }

  /**
   * Convert delta storage back to full content
   */
  async undeltify(id: ObjectId): Promise<void> {
    // Get object entry
    const entry = await this.objectRepo.loadObjectEntry(id);
    if (!entry) {
      throw new Error(`Object ${id} not found`);
    }

    // Check if this is actually a delta
    const deltaInfo = await this.deltaRepo.get(entry.recordId);
    if (!deltaInfo) {
      // Already full content
      return;
    }

    // Reconstruct full content from delta chain
    const fullContent = await this.reconstructFromDelta(entry.recordId);

    // Compress and store as full content
    const compressed = await compressBlock(fullContent, { raw: false });

    // Update object
    await this.objectRepo.storeObject({
      id: entry.id,
      size: entry.size,
      content: compressed,
      created: entry.created,
      accessed: Date.now(),
    });

    // Remove delta relationship
    await this.deltaRepo.delete(entry.recordId);

    // Invalidate caches
    this.contentCache.delete(id);
    this.intermediateCache.clear(entry.recordId);
  }

  /**
   * Get delta chain information for an object
   */
  async getDeltaChainInfo(id: ObjectId): Promise<DeltaChainInfo | undefined> {
    const entry = await this.objectRepo.loadObjectEntry(id);
    if (!entry) return undefined;

    const deltaInfo = await this.deltaRepo.get(entry.recordId);
    if (!deltaInfo) return undefined;

    const chain = await this.deltaRepo.getChain(entry.recordId);
    const baseRecordId = chain.length > 0 ? chain[chain.length - 1].baseRecordId : entry.recordId;

    const baseEntry = await this.objectRepo.loadObjectByRecordId(baseRecordId);
    if (!baseEntry) throw new Error(`Base object not found`);

    // Calculate savings: original compressed size - delta size
    const originalSize = entry.size; // Uncompressed
    const currentSize = entry.content.length; // Compressed delta

    return {
      baseId: baseEntry.id,
      depth: chain.length,
      savings: originalSize - currentSize,
    };
  }

  /**
   * Check if object is stored as delta
   */
  async isDelta(id: ObjectId): Promise<boolean> {
    const entry = await this.objectRepo.loadObjectEntry(id);
    if (!entry) return false;
    return this.deltaRepo.has(entry.recordId);
  }

  /**
   * Iterate over all object IDs in storage
   *
   * @returns AsyncGenerator yielding ObjectIds
   */
  async *listObjects(): AsyncGenerator<ObjectId> {
    const allIds = await this.objectRepo.getAllIds();
    for (const id of allIds) {
      yield id;
    }
  }

  /**
   * Reconstruct content from delta chain
   */
  private async reconstructFromDelta(objectRecordId: number): Promise<Uint8Array> {
    // Get entire delta chain from repository
    const chain = await this.deltaRepo.getChain(objectRecordId);

    // The chain is ordered from target back to base
    // Last entry points to the base (full content)
    const baseRecordId = chain.length > 0 ? chain[chain.length - 1].baseRecordId : objectRecordId;

    // Get base content
    const baseEntry = await this.objectRepo.loadObjectByRecordId(baseRecordId);
    if (!baseEntry) {
      throw new Error(`Base object record ${baseRecordId} not found`);
    }

    let content = await decompressBlock(baseEntry.content, { raw: false });

    // Apply deltas in reverse order (from base toward target)
    for (let i = chain.length - 1; i >= 0; i--) {
      const deltaEntry = chain[i];

      // Check for cached intermediate result
      const depth = chain.length - i;
      const cacheKey = `${baseRecordId}:${depth}`;
      const cached = this.intermediateCache.get(cacheKey);

      if (cached) {
        content = cached;
        continue;
      }

      // Get delta object (stored as compressed delta bytes)
      const deltaObj = await this.objectRepo.loadObjectByRecordId(deltaEntry.objectRecordId);
      if (!deltaObj) {
        throw new Error(`Delta object record ${deltaEntry.objectRecordId} not found`);
      }

      // Decompress delta bytes before applying
      const decompressedDelta = await decompressBlock(deltaObj.content, { raw: false });

      // Apply delta to get next version
      content = await this.applyDeltaBytes(content, decompressedDelta);

      // Cache intermediate results every 8 steps
      if (depth % 8 === 0) {
        this.intermediateCache.set(baseRecordId, depth, content);
      }
    }

    return content;
  }

  /**
   * Apply delta bytes to source content
   */
  private async applyDeltaBytes(source: Uint8Array, deltaBytes: Uint8Array): Promise<Uint8Array> {
    // Parse delta commands from Fossil format
    const deltaCommands = Array.from(decodeDeltaBlocks(deltaBytes));

    // Apply delta using existing implementation
    const chunks: Uint8Array[] = [];
    for (const chunk of applyDelta(source, deltaCommands)) {
      chunks.push(chunk);
    }

    return this.concatArrays(chunks);
  }

  /**
   * Concatenate Uint8Array chunks
   */
  private concatArrays(arrays: Uint8Array[]): Uint8Array {
    const totalSize = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }
}
