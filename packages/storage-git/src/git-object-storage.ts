/**
 * Git object storage implementation
 *
 * Combines loose objects and pack files to provide the ObjectStorage interface.
 * Writes go to loose objects; reads check loose first, then pack files.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/ObjectDirectory.java
 */

import type { ObjectId, ObjectStorage, ObjectTypeCode } from "@webrun-vcs/storage";
import { ObjectType } from "@webrun-vcs/storage";
import type { DirEntry, GitFilesApi } from "./git-files-api.js";
import { ObjectDirectory } from "./loose/index.js";
import { type PackIndex, readPackIndex } from "./pack/index.js";
import { PackReader } from "./pack/pack-reader.js";

/**
 * Object data with type information
 */
export interface GitObject {
  /** Object type code */
  type: ObjectTypeCode;
  /** Object content */
  content: Uint8Array;
  /** Content size */
  size: number;
}

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
 * Git object storage combining loose objects and pack files
 *
 * Implements the ObjectStorage interface for content-addressable storage.
 */
export class GitObjectStorage implements ObjectStorage {
  private readonly files: GitFilesApi;
  private readonly objectsDir: string;
  private readonly looseObjects: ObjectDirectory;
  private packFiles: PackFile[] = [];
  private packsLoaded = false;

  constructor(files: GitFilesApi, gitDir: string) {
    this.files = files;
    this.objectsDir = files.join(gitDir, "objects");
    this.looseObjects = new ObjectDirectory(files, this.objectsDir);
  }

  /**
   * Store object content
   *
   * Content is hashed to produce the ObjectId. If an object with the
   * same hash already exists, this is a no-op (deduplication).
   *
   * Note: This always stores as a blob. For typed storage, use storeTyped().
   */
  async store(data: AsyncIterable<Uint8Array>): Promise<ObjectId> {
    // Collect all chunks into a single buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of data) {
      chunks.push(chunk);
    }
    const content = concatUint8Arrays(chunks);

    // Store as blob (default type for ObjectStorage)
    return this.looseObjects.writeBlob(content);
  }

  /**
   * Store object with explicit type
   */
  async storeTyped(type: ObjectTypeCode, content: Uint8Array): Promise<ObjectId> {
    const typeStr = typeCodeToString(type);
    return this.looseObjects.write(typeStr, content);
  }

  /**
   * Load object content by ID
   *
   * Returns async iterable of content chunks.
   */
  load(id: ObjectId): AsyncIterable<Uint8Array> {
    return this.loadGenerator(id);
  }

  private async *loadGenerator(id: ObjectId): AsyncGenerator<Uint8Array> {
    const obj = await this.loadTyped(id);
    yield obj.content;
  }

  /**
   * Load object with type information
   */
  async loadTyped(id: ObjectId): Promise<GitObject> {
    // Try loose objects first
    const hasLoose = await this.looseObjects.has(id);
    if (hasLoose) {
      const data = await this.looseObjects.read(id);
      return {
        type: data.typeCode,
        content: data.content,
        size: data.size,
      };
    }

    // Try pack files
    await this.ensurePacksLoaded();
    for (const pack of this.packFiles) {
      if (pack.index.has(id)) {
        const reader = await this.getPackReader(pack);
        const obj = await reader.get(id);
        if (obj) {
          return {
            type: obj.type as ObjectTypeCode,
            content: obj.content,
            size: obj.size,
          };
        }
      }
    }

    throw new Error(`Object not found: ${id}`);
  }

  /**
   * Check if object exists
   */
  async has(id: ObjectId): Promise<boolean> {
    // Check loose objects first
    if (await this.looseObjects.has(id)) {
      return true;
    }

    // Check pack files
    await this.ensurePacksLoaded();
    for (const pack of this.packFiles) {
      if (pack.index.has(id)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Delete object
   *
   * Only deletes loose objects. Pack file objects cannot be deleted
   * without repacking.
   */
  async delete(id: ObjectId): Promise<boolean> {
    return this.looseObjects.delete(id);
  }

  /**
   * Get the objects directory path
   */
  getObjectsDir(): string {
    return this.objectsDir;
  }

  /**
   * Get the ObjectDirectory for direct access
   */
  getLooseObjects(): ObjectDirectory {
    return this.looseObjects;
  }

  /**
   * Ensure pack files are loaded
   */
  private async ensurePacksLoaded(): Promise<void> {
    if (this.packsLoaded) return;

    const packDir = this.files.join(this.objectsDir, "pack");
    let entries: DirEntry[];
    try {
      entries = await this.files.readdir(packDir);
    } catch {
      this.packsLoaded = true;
      return; // Pack directory doesn't exist
    }

    for (const entry of entries) {
      if (!entry.isFile || !entry.name.endsWith(".idx")) {
        continue;
      }

      const idxPath = this.files.join(packDir, entry.name);
      const packPath = idxPath.replace(/\.idx$/, ".pack");

      try {
        // Check pack file exists
        if (!(await this.files.exists(packPath))) {
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
   * Get the size of an object in bytes
   *
   * Returns the uncompressed content size, not the on-disk storage size.
   *
   * @param id Object ID to query
   * @returns Size in bytes, or -1 if object does not exist
   */
  async getSize(id: ObjectId): Promise<number> {
    // Try loose objects first
    const hasLoose = await this.looseObjects.has(id);
    if (hasLoose) {
      const header = await this.looseObjects.readHeader(id);
      return header.size;
    }

    // Try pack files
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
   * Iterate over all object IDs in storage
   *
   * @returns AsyncGenerator yielding ObjectIds
   */
  async *listObjects(): AsyncGenerator<ObjectId> {
    const seen = new Set<ObjectId>();

    // Enumerate loose objects
    for await (const id of this.looseObjects.list()) {
      seen.add(id);
      yield id;
    }

    // Enumerate packed objects (skip duplicates)
    await this.ensurePacksLoaded();
    for (const pack of this.packFiles) {
      for (const id of pack.index.listObjects()) {
        if (!seen.has(id)) {
          seen.add(id);
          yield id;
        }
      }
    }
  }
}

/**
 * Convert type code to string
 */
function typeCodeToString(type: ObjectTypeCode): "commit" | "tree" | "blob" | "tag" {
  switch (type) {
    case ObjectType.COMMIT:
      return "commit";
    case ObjectType.TREE:
      return "tree";
    case ObjectType.BLOB:
      return "blob";
    case ObjectType.TAG:
      return "tag";
    default:
      throw new Error(`Unknown object type: ${type}`);
  }
}

/**
 * Concatenate Uint8Arrays
 */
function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  if (arrays.length === 0) return new Uint8Array(0);
  if (arrays.length === 1) return arrays[0];

  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}
