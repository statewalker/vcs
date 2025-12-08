/**
 * Git object storage implementation
 *
 * Combines loose objects and pack files to provide the ObjectStorage interface.
 * Writes go to loose objects; reads check loose first, then pack files.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/ObjectDirectory.java
 */

import { type FileInfo, type FilesApi, joinPath } from "@statewalker/webrun-files";
import type { ObjectId, ObjectInfo, ObjectStorage, ObjectTypeString } from "@webrun-vcs/storage";
import { createGitObject, parseObjectHeader } from "./format/object-header.js";
import { hasLooseObject, readRawLooseObject } from "./loose/loose-object-reader.js";
import { writeRawLooseObject } from "./loose/loose-object-writer.js";
import { ObjectDirectory } from "./loose/object-directory.js";
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
 * Git object storage combining loose objects and pack files
 *
 * Implements the ObjectStorage interface for content-addressable storage.
 * Stores and loads raw Git objects (with header: "type size\0content").
 *
 * For typed object operations (storeTyped/loadTyped), use the utility
 * functions from typed-object-utils.ts instead.
 */
export class GitObjectStorage implements ObjectStorage {
  private readonly files: FilesApi;
  private readonly objectsDir: string;
  private readonly looseObjects: ObjectDirectory;
  private packFiles: PackFile[] = [];
  private packsLoaded = false;

  constructor(files: FilesApi, gitDir: string) {
    this.files = files;
    this.objectsDir = joinPath(gitDir, "objects");
    this.looseObjects = new ObjectDirectory(files, this.objectsDir);
  }

  /**
   * Store object content
   *
   * Content is hashed to produce the ObjectInfo. If an object with the
   * same hash already exists, this is a no-op (deduplication).
   *
   * Note: This stores content as a blob. For typed storage, use
   * storeTypedObject() from typed-object-utils.ts.
   */
  async store(data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectInfo> {
    // Collect all chunks into a single buffer
    const chunks: Uint8Array[] = [];

    // Handle both sync and async iterables
    if (Symbol.asyncIterator in data) {
      for await (const chunk of data as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
    } else {
      for (const chunk of data as Iterable<Uint8Array>) {
        chunks.push(chunk);
      }
    }

    const content = concatUint8Arrays(chunks);

    // Store as blob (default type for ObjectStorage)
    const id = await this.looseObjects.writeBlob(content);
    return { id, size: content.length };
  }

  /**
   * Load object content by ID
   *
   * Returns content without the Git header.
   * For typed objects with header parsing, use loadTypedObject() from typed-object-utils.ts.
   */
  async *load(
    id: ObjectId,
    params?: { offset?: number; length?: number },
  ): AsyncIterable<Uint8Array> {
    const content = await this.loadContent(id);

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
   * Load object content (without header)
   */
  private async loadContent(id: ObjectId): Promise<Uint8Array> {
    // Try loose objects first
    const hasLoose = await hasLooseObject(this.files, this.objectsDir, id);
    if (hasLoose) {
      const rawObject = await readRawLooseObject(this.files, this.objectsDir, id);
      const header = parseObjectHeader(rawObject);
      return rawObject.subarray(header.contentOffset);
    }

    // Try pack files
    await this.ensurePacksLoaded();
    for (const pack of this.packFiles) {
      if (pack.index.has(id)) {
        const reader = await this.getPackReader(pack);
        const obj = await reader.get(id);
        if (obj) {
          return obj.content;
        }
      }
    }

    throw new Error(`Object not found: ${id}`);
  }

  /**
   * Store raw Git object data (with header)
   *
   * Used by typed-object-utils for storing typed objects.
   * The object must be in Git format (header + content).
   */
  async storeRaw(fullObject: Uint8Array): Promise<ObjectId> {
    return writeRawLooseObject(this.files, this.objectsDir, fullObject);
  }

  /**
   * Load raw Git object data (with header)
   *
   * Used by typed-object-utils for loading objects with type information.
   */
  async loadRaw(id: ObjectId): Promise<Uint8Array> {
    // Try loose objects first
    const hasLoose = await hasLooseObject(this.files, this.objectsDir, id);
    if (hasLoose) {
      return readRawLooseObject(this.files, this.objectsDir, id);
    }

    // Try pack files
    await this.ensurePacksLoaded();
    for (const pack of this.packFiles) {
      if (pack.index.has(id)) {
        const reader = await this.getPackReader(pack);
        const obj = await reader.get(id);
        if (obj) {
          // Pack reader returns parsed content, reconstruct full object
          const typeStr = packTypeToString(obj.type);
          return createGitObject(typeStr, obj.content);
        }
      }
    }

    throw new Error(`Object not found: ${id}`);
  }

  /**
   * Get object metadata
   */
  async getInfo(id: ObjectId): Promise<ObjectInfo | null> {
    // Check loose objects first
    if (await this.looseObjects.has(id)) {
      const header = await this.looseObjects.readHeader(id);
      return { id, size: header.size };
    }

    // Check pack files
    await this.ensurePacksLoaded();
    for (const pack of this.packFiles) {
      if (pack.index.has(id)) {
        const reader = await this.getPackReader(pack);
        const obj = await reader.get(id);
        if (obj) {
          return { id, size: obj.size };
        }
      }
    }

    return null;
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
   * Iterate over all objects in storage
   *
   * @returns AsyncGenerator yielding ObjectInfos
   */
  async *listObjects(): AsyncGenerator<ObjectInfo> {
    const seen = new Set<ObjectId>();

    // Enumerate loose objects
    for await (const id of this.looseObjects.list()) {
      seen.add(id);
      const header = await this.looseObjects.readHeader(id);
      yield { id, size: header.size };
    }

    // Enumerate packed objects (skip duplicates)
    await this.ensurePacksLoaded();
    for (const pack of this.packFiles) {
      for (const id of pack.index.listObjects()) {
        if (!seen.has(id)) {
          seen.add(id);
          const reader = await this.getPackReader(pack);
          const obj = await reader.get(id);
          if (obj) {
            yield { id, size: obj.size };
          }
        }
      }
    }
  }
}

/**
 * Convert pack object type to string
 */
function packTypeToString(type: PackObjectType): ObjectTypeString {
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
