/**
 * Pack-based delta store
 *
 * Implements the DeltaStore interface using Git pack files.
 * Provides persistent delta storage with efficient multi-pack queries.
 *
 * Based on jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/PackDirectory.java
 */

import type { Delta } from "@webrun-vcs/utils";
import type { FilesApi } from "../files/index.js";
import { type FlushResult, PackDirectory, PackObjectType, PendingPack } from "../pack/index.js";
import { parseBinaryDelta, serializeDelta } from "./delta-binary-format.js";
import { type DeltaMetadata, DeltaMetadataIndex } from "./delta-metadata-index.js";
import type { DeltaChainDetails, DeltaInfo, DeltaStore, StoredDelta } from "./delta-store.js";

/** Default flush threshold (number of objects) */
const DEFAULT_FLUSH_THRESHOLD = 100;

/** Default flush size threshold (10MB) */
const DEFAULT_FLUSH_SIZE = 10 * 1024 * 1024;

/**
 * Options for PackDeltaStore
 */
export interface PackDeltaStoreOptions {
  /** FilesApi for storage operations */
  files: FilesApi;
  /** Base path for pack files (e.g., ".git/objects/pack") */
  basePath: string;
  /** Flush threshold (number of objects, default: 100) */
  flushThreshold?: number;
  /** Flush size threshold (bytes, default: 10MB) */
  flushSize?: number;
}

/**
 * Pack-based delta store
 *
 * Stores deltas in Git pack files with metadata index for fast lookups.
 */
export class PackDeltaStore implements DeltaStore {
  private readonly files: FilesApi;
  private readonly basePath: string;
  private readonly packDir: PackDirectory;
  private readonly metaIndex: DeltaMetadataIndex;
  private pending: PendingPack;
  private initialized = false;

  constructor(options: PackDeltaStoreOptions) {
    this.files = options.files;
    this.basePath = options.basePath;

    this.packDir = new PackDirectory({
      files: options.files,
      basePath: options.basePath,
    });

    this.metaIndex = new DeltaMetadataIndex({
      files: options.files,
      basePath: options.basePath,
      autoSave: true,
      saveDebounceMs: 1000,
    });

    this.pending = new PendingPack({
      maxObjects: options.flushThreshold ?? DEFAULT_FLUSH_THRESHOLD,
      maxBytes: options.flushSize ?? DEFAULT_FLUSH_SIZE,
    });
  }

  /**
   * Initialize the store
   *
   * Loads metadata index from disk.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.metaIndex.load();
    this.initialized = true;
  }

  /**
   * Store a delta relationship
   *
   * @param info Delta relationship (baseKey, targetKey)
   * @param delta Delta instructions
   * @returns Compressed size in bytes
   */
  async storeDelta(info: DeltaInfo, delta: Delta[]): Promise<number> {
    await this.ensureInitialized();

    // Serialize delta to Git binary format
    const binaryDelta = serializeDelta(delta);

    // Calculate depth
    const baseDepth = this.metaIndex.getChainDepth(info.baseKey);
    const depth = baseDepth + 1;

    // Calculate original size from delta instructions
    let originalSize = 0;
    for (const d of delta) {
      if (d.type === "start") {
        originalSize = d.targetLen;
        break;
      }
    }

    // Add to pending pack as BLOB (not as REF_DELTA)
    // This allows loading without delta resolution - metadata tracks the relationship
    this.pending.addObject(info.targetKey, PackObjectType.BLOB, binaryDelta);

    // Update metadata index (will get pack name after flush)
    // For now, use empty pack name - will be updated on flush
    const metadata: DeltaMetadata = {
      baseKey: info.baseKey,
      packName: "", // Will be updated after flush
      offset: 0, // Will be updated after flush
      depth,
      compressedSize: binaryDelta.length,
      originalSize,
    };
    this.metaIndex.setEntry(info.targetKey, metadata);

    // Auto-flush if threshold reached
    if (this.pending.shouldFlush()) {
      await this.flush();
    }

    return binaryDelta.length;
  }

  /**
   * Load delta for an object
   *
   * @param targetKey Target object key
   * @returns Stored delta with instructions, or undefined if not a delta
   */
  async loadDelta(targetKey: string): Promise<StoredDelta | undefined> {
    await this.ensureInitialized();

    const metadata = this.metaIndex.getMetadata(targetKey);
    if (!metadata) {
      return undefined;
    }

    // Check if in pending pack first
    if (this.pending.hasPending(targetKey)) {
      // Object is pending - flush to make it available
      await this.flush();
    }

    // Load from pack
    const packData = await this.packDir.load(targetKey);
    if (!packData) {
      // Object not found in packs - might have been removed
      return undefined;
    }

    // Parse binary delta to Delta[]
    const delta = parseBinaryDelta(packData);

    // Calculate ratio
    const ratio = metadata.originalSize > 0 ? metadata.compressedSize / metadata.originalSize : 1;

    return {
      baseKey: metadata.baseKey,
      targetKey,
      delta,
      ratio,
    };
  }

  /**
   * Check if object is stored as a delta
   *
   * @param targetKey Target object key
   * @returns True if object is stored as a delta
   */
  async isDelta(targetKey: string): Promise<boolean> {
    await this.ensureInitialized();
    // Metadata index is the source of truth for delta relationships
    return this.metaIndex.isDelta(targetKey);
  }

  /**
   * Remove delta relationship
   *
   * @param targetKey Target object key
   * @param keepAsBase If true, keeps the object available as base for other deltas
   * @returns True if removed
   */
  async removeDelta(targetKey: string, _keepAsBase?: boolean): Promise<boolean> {
    await this.ensureInitialized();

    // Note: We can only remove from metadata index.
    // Actual pack file removal requires GC/consolidation.
    const existed = this.metaIndex.removeEntry(targetKey);
    return existed;
  }

  /**
   * Get delta chain info for an object
   *
   * @param targetKey Target object key
   * @returns Chain details or undefined if not a delta
   */
  async getDeltaChainInfo(targetKey: string): Promise<DeltaChainDetails | undefined> {
    await this.ensureInitialized();

    const metadata = this.metaIndex.getMetadata(targetKey);
    if (!metadata) {
      return undefined;
    }

    const chain = this.metaIndex.getChain(targetKey);

    return {
      baseKey: metadata.baseKey,
      targetKey,
      depth: metadata.depth,
      originalSize: metadata.originalSize,
      compressedSize: metadata.compressedSize,
      chain,
    };
  }

  /**
   * List all delta relationships
   *
   * @returns Async iterable of delta info (baseKey, targetKey)
   */
  async *listDeltas(): AsyncIterable<DeltaInfo> {
    await this.ensureInitialized();

    for (const [targetKey, metadata] of this.metaIndex.allEntries()) {
      yield {
        baseKey: metadata.baseKey,
        targetKey,
      };
    }

    // Also yield pending deltas
    for (const id of this.pending.getPendingIds()) {
      // Skip if already in index (shouldn't happen, but be safe)
      if (!this.metaIndex.isDelta(id)) {
        const metadata = this.metaIndex.getMetadata(id);
        if (metadata) {
          yield {
            baseKey: metadata.baseKey,
            targetKey: id,
          };
        }
      }
    }
  }

  /**
   * Flush pending objects to a new pack file
   */
  async flush(): Promise<void> {
    if (this.pending.isEmpty()) {
      return;
    }

    const pendingIds = this.pending.getPendingIds();
    const result = await this.pending.flush();

    // Write pack files
    await this.packDir.addPack(result.packName, result.packData, result.indexData);

    // Update metadata with pack info
    this.updateMetadataWithPackInfo(result, pendingIds);

    // Invalidate pack directory cache to see new pack
    await this.packDir.invalidate();
  }

  /**
   * Close the store
   *
   * Flushes pending objects and saves metadata.
   */
  async close(): Promise<void> {
    // Flush any pending objects
    await this.flush();

    // Save metadata
    await this.metaIndex.close();
  }

  /**
   * Get pack directory for advanced operations
   */
  getPackDirectory(): PackDirectory {
    return this.packDir;
  }

  /**
   * Get metadata index for advanced operations
   */
  getMetadataIndex(): DeltaMetadataIndex {
    return this.metaIndex;
  }

  /**
   * Ensure store is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Update metadata entries with pack file information
   */
  private updateMetadataWithPackInfo(result: FlushResult, pendingIds: string[]): void {
    // Build offset map from result entries
    const offsetMap = new Map<string, { offset: number; crc32: number }>();
    for (const entry of result.entries) {
      offsetMap.set(entry.id, { offset: entry.offset, crc32: entry.crc32 });
    }

    // Update each pending ID's metadata
    for (const id of pendingIds) {
      const existingMetadata = this.metaIndex.getMetadata(id);
      if (existingMetadata) {
        const packInfo = offsetMap.get(id);
        if (packInfo) {
          this.metaIndex.setEntry(id, {
            ...existingMetadata,
            packName: result.packName,
            offset: packInfo.offset,
          });
        }
      }
    }
  }
}
