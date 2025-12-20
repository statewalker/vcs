/**
 * Git Delta Object Storage
 *
 * @deprecated This class implements the deprecated ObjectStore interface.
 * Use the new architecture instead:
 * - FileBinStore from binary-storage for raw + delta storage
 * - createFileObjectStores() from object-storage for Git-compatible stores
 *
 * Implements DeltaObjectStore interface for Git repositories.
 *
 * Architecture:
 * - Pack files are immutable (read-only)
 * - deltify() creates new pack files with delta objects
 * - undeltify() writes full object to loose storage (shadows packed version)
 * - repack() consolidates everything into optimized pack files
 *
 * This mirrors Git's actual behavior where modifications create new
 * storage artifacts, and `git gc` consolidates them.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/GC.java
 */

import type { FilesApi } from "@statewalker/webrun-files";
import { createDeltaRanges, deltaRangesToGitFormat } from "@webrun-vcs/utils";
import type { ObjectId, ObjectStore } from "@webrun-vcs/vcs";

/**
 * Options for delta creation
 */
export interface GitDeltaOptions {
  /** Minimum size for deltification (default: 50 bytes) */
  minSize?: number;
  /** Minimum compression ratio to accept delta (default: 0.75 = 25% savings) */
  minCompressionRatio?: number;
  /** Maximum delta chain depth (default: 50, matching JGit) */
  maxChainDepth?: number;
}

/**
 * Delta chain information
 */
export interface GitDeltaChainInfo {
  /** ObjectId of the base (non-delta) object */
  baseId: ObjectId;
  /** Chain depth (0 = full object, 1+ = delta depth) */
  depth: number;
  /** Total size savings (original - current compressed) */
  savings: number;
}

import { CompositeObjectStorage } from "./composite-object-storage.js";
import { parseObjectHeader } from "./format/object-header.js";
import { GitPackStorage } from "./git-pack-storage.js";
import { PackWriterStream, writePackIndex } from "./pack/index.js";
import { PackObjectType } from "./pack/types.js";
import { atomicWriteFile, bytesToHex, concatBytes, ensureDir } from "./utils/index.js";

/** Default minimum size for deltification */
const DEFAULT_MIN_SIZE = 50;

/** Default minimum compression ratio (25% savings) */
const DEFAULT_MIN_COMPRESSION_RATIO = 0.75;

/** Default maximum delta chain depth */
const DEFAULT_MAX_CHAIN_DEPTH = 50;

/**
 * Convert object type string to PackObjectType
 */
function typeStringToPackType(type: string): PackObjectType {
  switch (type) {
    case "commit":
      return PackObjectType.COMMIT;
    case "tree":
      return PackObjectType.TREE;
    case "blob":
      return PackObjectType.BLOB;
    case "tag":
      return PackObjectType.TAG;
    default:
      throw new Error(`Unknown object type: ${type}`);
  }
}

/**
 * Git-compatible delta object storage
 *
 * Provides deltify/undeltify operations by creating new storage artifacts
 * (pack files for deltas, loose objects for undeltified content).
 */
export class GitDeltaObjectStorage implements ObjectStore {
  private readonly files: FilesApi;
  private readonly gitDir: string;
  private readonly looseStorage: ObjectStore;
  private readonly packStorage: GitPackStorage;
  private readonly composite: CompositeObjectStorage;

  constructor(files: FilesApi, gitDir: string, looseStorage: ObjectStore) {
    this.files = files;
    this.gitDir = gitDir;
    this.looseStorage = looseStorage;
    this.packStorage = new GitPackStorage(files, gitDir);
    // Loose objects take priority (they shadow packed versions)
    this.composite = new CompositeObjectStorage(this.packStorage, [this.looseStorage]);
  }

  // ========== ObjectStore Methods (delegate to composite) ==========

  async store(data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId> {
    return this.looseStorage.store(data);
  }

  async *load(
    id: ObjectId,
    params?: { offset?: number; length?: number },
  ): AsyncIterable<Uint8Array> {
    yield* this.composite.load(id, params);
  }

  async getSize(id: ObjectId): Promise<number> {
    return this.composite.getSize(id);
  }

  async has(id: ObjectId): Promise<boolean> {
    return this.composite.has(id);
  }

  async delete(id: ObjectId): Promise<boolean> {
    return this.composite.delete(id);
  }

  async *listObjects(): AsyncGenerator<ObjectId> {
    yield* this.composite.listObjects();
  }

  // ========== DeltaObjectStore Methods ==========

  /**
   * Check if object is stored as a delta
   *
   * Only checks pack storage - loose objects are never deltas.
   */
  async isDelta(id: ObjectId): Promise<boolean> {
    // If object exists in loose storage, it's not a delta
    if (await this.looseStorage.has(id)) {
      return false;
    }
    return this.packStorage.isDelta(id);
  }

  /**
   * Get delta chain information
   */
  async getDeltaChainInfo(id: ObjectId): Promise<GitDeltaChainInfo | undefined> {
    // Loose objects are never deltas
    if (await this.looseStorage.has(id)) {
      return undefined;
    }
    return this.packStorage.getDeltaChainInfo(id);
  }

  /**
   * Deltify an object against candidate bases
   *
   * Creates a new pack file containing the delta. The original
   * object remains in its current location until repack.
   */
  async deltify(
    targetId: ObjectId,
    candidateIds: ObjectId[],
    options?: GitDeltaOptions,
  ): Promise<boolean> {
    const minSize = options?.minSize ?? DEFAULT_MIN_SIZE;
    const minRatio = options?.minCompressionRatio ?? DEFAULT_MIN_COMPRESSION_RATIO;
    const maxChainDepth = options?.maxChainDepth ?? DEFAULT_MAX_CHAIN_DEPTH;

    // Load target content
    const targetContent = await this.loadRawContent(targetId);
    if (!targetContent || targetContent.length < minSize) {
      return false; // Too small to deltify
    }

    // Check current chain depth if already a delta
    const currentChain = await this.getDeltaChainInfo(targetId);
    if (currentChain && currentChain.depth >= maxChainDepth) {
      return false; // Chain too deep
    }

    // Find best delta base
    let bestDelta: { baseId: ObjectId; delta: Uint8Array } | null = null;
    let bestRatio = minRatio;

    for (const candidateId of candidateIds) {
      // Check candidate chain depth
      const candidateChain = await this.getDeltaChainInfo(candidateId);
      const candidateDepth = candidateChain?.depth ?? 0;
      if (candidateDepth + 1 >= maxChainDepth) {
        continue; // Would exceed max depth
      }

      const baseContent = await this.loadRawContent(candidateId);
      if (!baseContent) continue;

      // Compute delta
      const ranges = [...createDeltaRanges(baseContent, targetContent)];
      const delta = deltaRangesToGitFormat(baseContent, targetContent, ranges);

      const ratio = delta.length / targetContent.length;
      if (ratio < bestRatio) {
        bestDelta = { baseId: candidateId, delta };
        bestRatio = ratio;
      }
    }

    if (!bestDelta) {
      return false; // No good delta found
    }

    // Create new pack with delta
    const packStream = new PackWriterStream();

    // Use REF_DELTA which doesn't require base to be in same pack
    await packStream.addRefDelta(targetId, bestDelta.baseId, bestDelta.delta);

    const result = await packStream.finalize();

    // Write pack and index
    const packName = bytesToHex(result.packChecksum);
    const packDir = `${this.gitDir}/objects/pack`;
    const packPath = `${packDir}/pack-${packName}.pack`;
    const idxPath = `${packDir}/pack-${packName}.idx`;

    // Ensure pack directory exists
    await ensureDir(this.files, packDir);

    await atomicWriteFile(this.files, packPath, result.packData);
    const indexData = await writePackIndex(result.indexEntries, result.packChecksum);
    await atomicWriteFile(this.files, idxPath, indexData);

    // Refresh pack storage to see new pack
    await this.packStorage.refresh();

    // Remove loose object so the delta version is actually used
    // (loose objects shadow packed versions in composite storage)
    await this.looseStorage.delete(targetId);

    return true;
  }

  /**
   * Undeltify an object (convert to full content)
   *
   * Writes the fully resolved content to loose storage,
   * which shadows the packed delta version.
   */
  async undeltify(id: ObjectId): Promise<void> {
    // Check if actually a delta
    if (!(await this.isDelta(id))) {
      return; // Already a full object
    }

    // Load full content (resolved through delta chain)
    const content = await this.loadFullContent(id);
    if (!content) {
      throw new Error(`Failed to load content for object: ${id}`);
    }

    // Write as loose object (this shadows the packed delta)
    await this.looseStorage.store(content);
  }

  /**
   * Repack storage for optimal delta chains
   *
   * This is the Git GC operation - creates new optimized pack files
   * and removes old/redundant storage.
   *
   * @param options.maxDepth - Maximum delta chain depth
   * @param options.windowSize - Size of sliding window for delta candidates (default: 10)
   * @param options.aggressive - Use more aggressive compression
   * @param options.pruneLoose - Remove loose objects after packing (default: true)
   */
  async repack(options?: {
    maxDepth?: number;
    windowSize?: number;
    aggressive?: boolean;
    pruneLoose?: boolean;
  }): Promise<void> {
    const windowSize = options?.windowSize ?? 10;
    const pruneLoose = options?.pruneLoose ?? true;

    // Collect all objects
    const objects: { id: ObjectId; content: Uint8Array; type: PackObjectType; size: number }[] = [];

    for await (const id of this.listObjects()) {
      const content = await this.loadRawContent(id);
      const objectType = await this.getObjectType(id);
      if (content && objectType) {
        objects.push({
          id,
          content,
          type: objectType,
          size: content.length,
        });
      }
    }

    if (objects.length === 0) {
      return;
    }

    // Sort by size descending (larger objects as potential bases)
    objects.sort((a, b) => b.size - a.size);

    // Build new optimized pack
    const packStream = new PackWriterStream();
    const window: { id: ObjectId; content: Uint8Array }[] = [];
    const written = new Set<ObjectId>();

    for (const obj of objects) {
      let bestDelta: { baseId: ObjectId; delta: Uint8Array } | null = null;
      let bestRatio = DEFAULT_MIN_COMPRESSION_RATIO;

      // Try to find delta base in window
      for (const base of window) {
        if (!written.has(base.id)) continue;

        const ranges = [...createDeltaRanges(base.content, obj.content)];
        const delta = deltaRangesToGitFormat(base.content, obj.content, ranges);

        const ratio = delta.length / obj.content.length;
        if (ratio < bestRatio) {
          bestDelta = { baseId: base.id, delta };
          bestRatio = ratio;
        }
      }

      // Write object
      if (bestDelta) {
        await packStream.addOfsDelta(obj.id, bestDelta.baseId, bestDelta.delta);
      } else {
        await packStream.addObject(obj.id, obj.type, obj.content);
      }
      written.add(obj.id);

      // Update sliding window
      window.push({ id: obj.id, content: obj.content });
      if (window.length > windowSize) {
        window.shift();
      }
    }

    const result = await packStream.finalize();

    // Write new pack
    const packName = bytesToHex(result.packChecksum);
    const packDir = `${this.gitDir}/objects/pack`;
    const packPath = `${packDir}/pack-${packName}.pack`;
    const idxPath = `${packDir}/pack-${packName}.idx`;

    await ensureDir(this.files, packDir);
    await atomicWriteFile(this.files, packPath, result.packData);
    const indexData = await writePackIndex(result.indexEntries, result.packChecksum);
    await atomicWriteFile(this.files, idxPath, indexData);

    await this.packStorage.refresh();

    // Prune loose objects that are now in the new pack
    if (pruneLoose) {
      await this.pruneLooseObjects();
    }
  }

  /**
   * Prune loose objects that exist in pack storage
   *
   * Removes loose object files for objects that are safely stored in pack files.
   * This is called automatically by repack() unless pruneLoose is set to false.
   *
   * @returns Number of loose objects pruned
   */
  async pruneLooseObjects(): Promise<number> {
    let pruned = 0;

    // Collect all loose object IDs first (to avoid modifying while iterating)
    const looseIds: ObjectId[] = [];
    for await (const id of this.looseStorage.listObjects()) {
      looseIds.push(id);
    }

    // Delete loose objects that exist in pack storage
    for (const id of looseIds) {
      if (await this.packStorage.has(id)) {
        const deleted = await this.looseStorage.delete(id);
        if (deleted) {
          pruned++;
        }
      }
    }

    return pruned;
  }

  // ========== Helper Methods ==========

  /**
   * Load raw object content (without Git header)
   */
  private async loadRawContent(id: ObjectId): Promise<Uint8Array | undefined> {
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of this.load(id)) {
        chunks.push(chunk);
      }
      const fullData = concatBytes(...chunks);

      // Parse Git object header to get content
      const header = parseObjectHeader(fullData);
      return fullData.subarray(header.contentOffset);
    } catch {
      return undefined;
    }
  }

  /**
   * Load full object content as iterable (for store)
   */
  private async loadFullContent(id: ObjectId): Promise<Uint8Array[] | undefined> {
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of this.load(id)) {
        chunks.push(chunk);
      }
      return chunks;
    } catch {
      return undefined;
    }
  }

  /**
   * Get object type from storage
   */
  private async getObjectType(id: ObjectId): Promise<PackObjectType | undefined> {
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of this.load(id)) {
        chunks.push(chunk);
        // Only need first chunk for header
        break;
      }
      if (chunks.length === 0) return undefined;

      const header = parseObjectHeader(chunks[0]);
      return typeStringToPackType(header.type);
    } catch {
      return undefined;
    }
  }

  /**
   * Refresh pack storage (call after gc or external fetch)
   *
   * Re-scans the objects/pack directory for new pack files.
   */
  async refresh(): Promise<void> {
    await this.packStorage.refresh();
  }

  /**
   * Close storage
   */
  async close(): Promise<void> {
    await this.composite.close();
  }
}
