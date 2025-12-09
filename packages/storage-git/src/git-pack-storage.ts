/**
 * Git pack storage implementation
 *
 * Provides read-only ObjectStorage interface for Git pack files.
 * Scans the objects/pack directory for pack files and their indexes,
 * and provides unified access to all packed objects.
 *
 * This is a read-only storage - store() and delete() are not supported.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/ObjectDirectory.java
 */

import { type FileInfo, type FilesApi, joinPath } from "@statewalker/webrun-files";
import type { DeltaChainInfo, ObjectId, ObjectStorage } from "@webrun-vcs/storage";
import { createGitObject } from "./format/object-header.js";
import { type PackIndex, PackObjectType, readPackIndex } from "./pack/index.js";
import { PackReader } from "./pack/pack-reader.js";

/**
 * Pack file with its index
 */
interface PackFile {
  /** Pack file path */
  packPath: string;
  /** Pack index */
  index: PackIndex;
  /** Pack reader (lazily created) */
  reader?: PackReader;
}

/**
 * Git pack storage implementation
 *
 * Implements ObjectStorage for reading from pack files.
 * This is read-only storage - all write operations throw errors.
 */
export class GitPackStorage implements ObjectStorage {
  private readonly files: FilesApi;
  private readonly objectsDir: string;
  private packFiles: PackFile[] = [];
  private packsLoaded = false;

  constructor(files: FilesApi, gitDir: string) {
    this.files = files;
    this.objectsDir = joinPath(gitDir, "objects");
  }

  /**
   * Store is not supported for pack storage
   */
  async store(_data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId> {
    throw new Error("GitPackStorage is read-only. Use GitRawObjectStorage for writing.");
  }

  /**
   * Load object content by ID
   *
   * Returns raw Git object content (with header).
   */
  async *load(
    id: ObjectId,
    params?: { offset?: number; length?: number },
  ): AsyncIterable<Uint8Array> {
    await this.ensurePacksLoaded();

    for (const pack of this.packFiles) {
      if (pack.index.has(id)) {
        const reader = await this.getPackReader(pack);
        const obj = await reader.get(id);
        if (obj) {
          // Reconstruct full Git object with header
          const typeStr = packTypeToString(obj.type);
          const fullObject = createGitObject(typeStr, obj.content);

          // Apply offset and length if specified
          const offset = params?.offset ?? 0;
          const length = params?.length ?? fullObject.length - offset;
          const end = Math.min(offset + length, fullObject.length);

          if (offset >= fullObject.length) {
            return;
          }

          yield fullObject.subarray(offset, end);
          return;
        }
      }
    }

    throw new Error(`Object not found in pack files: ${id}`);
  }

  /**
   * Get object size
   */
  async getSize(id: ObjectId): Promise<number> {
    await this.ensurePacksLoaded();

    for (const pack of this.packFiles) {
      if (pack.index.has(id)) {
        const reader = await this.getPackReader(pack);
        const obj = await reader.get(id);
        if (obj) {
          return obj.size;
        }
      }
    }

    return -1;
  }

  /**
   * Check if object exists
   */
  async has(id: ObjectId): Promise<boolean> {
    await this.ensurePacksLoaded();

    for (const pack of this.packFiles) {
      if (pack.index.has(id)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Delete is not supported for pack storage
   */
  async delete(_id: ObjectId): Promise<boolean> {
    throw new Error("GitPackStorage is read-only. Cannot delete objects from pack files.");
  }

  /**
   * Ensure pack files are loaded
   */
  private async ensurePacksLoaded(): Promise<void> {
    if (this.packsLoaded) return;

    const packDir = joinPath(this.objectsDir, "pack");
    const entries: FileInfo[] = [];
    try {
      for await (const entry of this.files.list(packDir)) {
        entries.push(entry);
      }
    } catch {
      this.packsLoaded = true;
      return; // Pack directory doesn't exist
    }

    for (const entry of entries) {
      if (entry.kind !== "file" || !entry.name.endsWith(".idx")) {
        continue;
      }

      const idxPath = joinPath(packDir, entry.name);
      const packPath = idxPath.replace(/\.idx$/, ".pack");

      try {
        // Check pack file exists
        const packStats = await this.files.stats(packPath);
        if (!packStats) {
          continue;
        }

        // Load index
        const idxData = await this.files.readFile(idxPath);
        const index = readPackIndex(idxData);

        this.packFiles.push({
          packPath,
          index,
        });
      } catch {
        // Skip invalid pack files
      }
    }

    this.packsLoaded = true;
  }

  /**
   * Get or create pack reader
   */
  private async getPackReader(pack: PackFile): Promise<PackReader> {
    if (!pack.reader) {
      pack.reader = new PackReader(this.files, pack.packPath, pack.index);
      await pack.reader.open();
    }
    return pack.reader;
  }

  /**
   * Close all pack readers
   */
  async close(): Promise<void> {
    for (const pack of this.packFiles) {
      if (pack.reader) {
        await pack.reader.close();
        pack.reader = undefined;
      }
    }
  }

  /**
   * Refresh pack file list
   */
  async refresh(): Promise<void> {
    await this.close();
    this.packFiles = [];
    this.packsLoaded = false;
  }

  /**
   * Iterate over all object IDs in pack storage
   *
   * @returns AsyncGenerator yielding ObjectIds
   */
  async *listObjects(): AsyncGenerator<ObjectId> {
    await this.ensurePacksLoaded();

    const seen = new Set<ObjectId>();

    for (const pack of this.packFiles) {
      for (const id of pack.index.listObjects()) {
        if (!seen.has(id)) {
          seen.add(id);
          yield id;
        }
      }
    }
  }

  /**
   * Check if an object is stored as a delta
   *
   * @param id Object ID to check
   * @returns True if the object is stored as a delta (OFS_DELTA or REF_DELTA)
   */
  async isDelta(id: ObjectId): Promise<boolean> {
    await this.ensurePacksLoaded();

    for (const pack of this.packFiles) {
      if (pack.index.has(id)) {
        const reader = await this.getPackReader(pack);
        return reader.isDelta(id);
      }
    }

    return false;
  }

  /**
   * Get delta chain information for an object
   *
   * @param id Object ID to query
   * @returns Delta chain info or undefined if not a delta
   */
  async getDeltaChainInfo(id: ObjectId): Promise<DeltaChainInfo | undefined> {
    await this.ensurePacksLoaded();

    for (const pack of this.packFiles) {
      if (pack.index.has(id)) {
        const reader = await this.getPackReader(pack);
        return reader.getDeltaChainInfo(id);
      }
    }

    return undefined;
  }
}

/**
 * Convert pack object type to string
 */
function packTypeToString(type: PackObjectType): "commit" | "tree" | "blob" | "tag" {
  switch (type) {
    case PackObjectType.COMMIT:
      return "commit";
    case PackObjectType.TREE:
      return "tree";
    case PackObjectType.BLOB:
      return "blob";
    case PackObjectType.TAG:
      return "tag";
    default:
      throw new Error(`Unknown pack object type: ${type}`);
  }
}
