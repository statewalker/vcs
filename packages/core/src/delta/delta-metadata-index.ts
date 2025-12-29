/**
 * Delta metadata index
 *
 * Tracks delta relationships and metadata for fast lookups.
 * Persists to JSON file for durability.
 *
 * Based on jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/PackDirectory.java
 */

import { type FilesApi, joinPath } from "../files/index.js";
import type { PackDirectory } from "../pack/index.js";

/** Index file name */
const INDEX_FILE = "delta-index.json";

/** Current index format version */
const INDEX_VERSION = 1;

/**
 * Metadata for a single delta entry
 */
export interface DeltaMetadata {
  /** Base object key (source for delta) */
  baseKey: string;
  /** Name of pack file containing the delta */
  packName: string;
  /** Byte offset within the pack file */
  offset: number;
  /** Delta chain depth (1 = direct, 2+ = chained) */
  depth: number;
  /** Compressed size in bytes */
  compressedSize: number;
  /** Original uncompressed size */
  originalSize: number;
}

/**
 * Options for DeltaMetadataIndex
 */
export interface DeltaMetadataIndexOptions {
  /** FilesApi for persistence */
  files: FilesApi;
  /** Base path for index file storage */
  basePath: string;
  /** Enable auto-save on modifications (default: true) */
  autoSave?: boolean;
  /** Debounce delay for auto-save in ms (default: 1000) */
  saveDebounceMs?: number;
}

/**
 * Serialized index format for persistence
 */
interface SerializedIndex {
  version: number;
  entries: Record<string, DeltaMetadata>;
}

/**
 * Delta metadata index
 *
 * Maintains an in-memory map of delta relationships with optional
 * auto-persistence to disk.
 */
export class DeltaMetadataIndex {
  private readonly files: FilesApi;
  private readonly basePath: string;
  private readonly autoSave: boolean;
  private readonly saveDebounceMs: number;
  private entries: Map<string, DeltaMetadata> = new Map();
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: DeltaMetadataIndexOptions) {
    this.files = options.files;
    this.basePath = options.basePath;
    this.autoSave = options.autoSave ?? true;
    this.saveDebounceMs = options.saveDebounceMs ?? 1000;
  }

  /**
   * Check if object is stored as a delta
   */
  isDelta(targetKey: string): boolean {
    return this.entries.has(targetKey);
  }

  /**
   * Get metadata for a target object
   */
  getMetadata(targetKey: string): DeltaMetadata | undefined {
    return this.entries.get(targetKey);
  }

  /**
   * Add or update a delta entry
   */
  setEntry(targetKey: string, metadata: DeltaMetadata): void {
    this.entries.set(targetKey, metadata);
    this.markDirty();
  }

  /**
   * Remove a delta entry
   */
  removeEntry(targetKey: string): boolean {
    const existed = this.entries.delete(targetKey);
    if (existed) {
      this.markDirty();
    }
    return existed;
  }

  /**
   * Iterate all entries
   */
  *allEntries(): IterableIterator<[string, DeltaMetadata]> {
    yield* this.entries;
  }

  /**
   * Get number of entries
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Check if index has unsaved changes
   */
  get isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Get the depth of the delta chain for a target
   *
   * Follows baseKey references to find the root.
   */
  getChainDepth(targetKey: string): number {
    const metadata = this.entries.get(targetKey);
    if (!metadata) return 0;
    return metadata.depth;
  }

  /**
   * Get full delta chain from target to base
   *
   * @returns Array of [targetKey, baseKey] pairs from target to root
   */
  getChain(targetKey: string): string[] {
    const chain: string[] = [targetKey];
    let current = targetKey;

    while (true) {
      const metadata = this.entries.get(current);
      if (!metadata) break;
      chain.push(metadata.baseKey);
      current = metadata.baseKey;
    }

    return chain;
  }

  /**
   * Find all deltas that use a given base
   */
  findDependents(baseKey: string): string[] {
    const dependents: string[] = [];
    for (const [targetKey, metadata] of this.entries) {
      if (metadata.baseKey === baseKey) {
        dependents.push(targetKey);
      }
    }
    return dependents;
  }

  /**
   * Persist index to disk
   */
  async save(): Promise<void> {
    // Cancel pending auto-save
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    if (!this.dirty && this.entries.size === 0) {
      return;
    }

    const serialized: SerializedIndex = {
      version: INDEX_VERSION,
      entries: Object.fromEntries(this.entries),
    };

    const json = JSON.stringify(serialized, null, 2);
    const data = new TextEncoder().encode(json);

    // Ensure directory exists
    const exists = await this.files.exists(this.basePath);
    if (!exists) {
      await this.files.mkdir(this.basePath);
    }

    const indexPath = joinPath(this.basePath, INDEX_FILE);
    await this.files.write(indexPath, [data]);

    this.dirty = false;
  }

  /**
   * Load index from disk
   *
   * Handles missing/corrupted file gracefully.
   */
  async load(): Promise<void> {
    const indexPath = joinPath(this.basePath, INDEX_FILE);

    try {
      const exists = await this.files.exists(indexPath);
      if (!exists) {
        return;
      }

      const data = await this.files.readFile(indexPath);
      const json = new TextDecoder().decode(data);
      const parsed = JSON.parse(json) as SerializedIndex;

      // Validate version
      if (parsed.version !== INDEX_VERSION) {
        console.warn(
          `Delta index version mismatch: expected ${INDEX_VERSION}, got ${parsed.version}`,
        );
        return;
      }

      this.entries = new Map(Object.entries(parsed.entries));
      this.dirty = false;
    } catch (error) {
      // Handle corrupted file gracefully
      console.warn("Failed to load delta index, starting fresh:", error);
      this.entries.clear();
    }
  }

  /**
   * Rebuild index from pack directory
   *
   * Scans all pack files to rebuild delta relationships.
   * This is an expensive operation - use only for recovery.
   */
  async rebuild(packDir: PackDirectory): Promise<RebuildResult> {
    const startTime = Date.now();
    let scanned = 0;
    let deltasFound = 0;

    this.entries.clear();

    const packNames = await packDir.scan();

    for (const packName of packNames) {
      const reader = await packDir.getPack(packName);
      const index = await packDir.getIndex(packName);

      for (const entry of index.entries()) {
        scanned++;

        // Check if this object is a delta by reading its header
        if (await reader.isDelta(entry.id)) {
          const chainInfo = await reader.getDeltaChainInfo(entry.id);
          if (chainInfo) {
            deltasFound++;
            this.entries.set(entry.id, {
              baseKey: chainInfo.baseId,
              packName,
              offset: entry.offset,
              depth: chainInfo.depth,
              compressedSize: 0, // Not easily available without parsing
              originalSize: 0,
            });
          }
        }
      }
    }

    // Mark as dirty to trigger save
    this.dirty = true;

    return {
      packsScanned: packNames.length,
      objectsScanned: scanned,
      deltasFound,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Clear all entries
   */
  clear(): void {
    if (this.entries.size > 0) {
      this.entries.clear();
      this.markDirty();
    }
  }

  /**
   * Close the index, saving if dirty
   */
  async close(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) {
      await this.save();
    }
  }

  /**
   * Mark index as dirty and schedule auto-save
   */
  private markDirty(): void {
    this.dirty = true;

    if (this.autoSave) {
      this.scheduleSave();
    }
  }

  /**
   * Schedule debounced save
   */
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save().catch((error) => {
        console.error("Auto-save failed:", error);
      });
    }, this.saveDebounceMs);
  }
}

/**
 * Result of rebuild operation
 */
export interface RebuildResult {
  /** Number of pack files scanned */
  packsScanned: number;
  /** Total objects scanned */
  objectsScanned: number;
  /** Delta objects found */
  deltasFound: number;
  /** Time taken in milliseconds */
  durationMs: number;
}
