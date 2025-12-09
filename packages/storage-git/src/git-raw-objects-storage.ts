/**
 * Git raw object storage implementation for loose objects.
 *
 * This class provides low-level storage operations for Git objects stored as individual files
 * in the `.git/objects` directory structure. Objects are stored in a two-level directory
 * hierarchy where the first two characters of the SHA-1 hash form the directory name,
 * and the remaining 38 characters form the filename.
 *
 * The storage handles:
 * - Storing raw object content with automatic SHA-1 hashing and deduplication
 * - Loading objects by their SHA-1 identifier
 * - Atomic writes using temporary files and rename operations
 * - Listing all loose objects in the repository
 * - Deleting individual loose objects
 *
 * Note: This class works with raw object content without Git headers or type information.
 * For typed Git objects (blob, tree, commit, tag), use the typed object utilities.
 *
 * @remarks
 * Implementation inspired by JGit's ObjectDirectory.java
 *
 * @example
 * ```typescript
 * const storage = new GitRawObjectStorage(filesApi, '/path/to/.git');
 *
 * // Store raw content
 * const info = await storage.store(dataStream);
 * console.log(`Stored object: ${info.id}`);
 *
 * // Load content back
 * for await (const chunk of storage.load(info.id)) {
 *   // Process chunk
 * }
 * ```
 */

import { type FileInfo, type FilesApi, joinPath } from "@statewalker/webrun-files";
import { compressBlock, decompressBlock } from "@webrun-vcs/compression";
import { sha1 } from "@webrun-vcs/hash/sha1";
import { bytesToHex } from "@webrun-vcs/hash/utils";
import type { ObjectId, ObjectStorage } from "@webrun-vcs/storage";
import { getLooseObjectPath } from "./utils/file-utils.js";

/**
 * Git raw object storage implementation for loose objects
 *
 * Stores and loads raw bytes without any interpretation or header handling.
 * This is the lowest level storage that other storages build upon.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/ObjectDirectory.java
 */
export class GitRawObjectStorage implements ObjectStorage {
  private readonly files: FilesApi;
  private readonly objectsDir: string;

  constructor(files: FilesApi, gitDir: string) {
    this.files = files;
    this.objectsDir = joinPath(gitDir, "objects");
  }

  /**
   * Store raw content as a compressed loose object
   *
   * Content is hashed to produce the object ID. If an object with the
   * same hash already exists, this is a no-op (deduplication).
   *
   * The content should be a complete Git object (header + content).
   * It will be compressed using zlib before writing to disk.
   *
   * Reference: jgit ObjectDirectoryInserter.toTemp()
   */
  async store(data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId> {
    // Collect all chunks
    const chunks: Uint8Array[] = [];

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

    // Hash the uncompressed content (Git hashes the logical object)
    const id = bytesToHex(await sha1(content));
    const path = getLooseObjectPath(this.objectsDir, id);

    // Check if object already exists (deduplication)
    if (await this.files.exists(path)) {
      return id;
    }

    // Compress using zlib (raw: false for standard zlib header)
    const compressed = await compressBlock(content, { raw: false });

    // Write compressed data to file
    await this.files.write(path, [compressed]);

    return id;
  }

  /**
   * Load object content by ID
   *
   * Reads and decompresses a loose object file. Returns the full Git object
   * (header + content). For typed objects with header parsing, use
   * loadTypedObject() from typed-object-utils.ts.
   *
   * Reference: jgit UnpackedObject.open()
   */
  async *load(
    id: ObjectId,
    params?: { offset?: number; length?: number },
  ): AsyncIterable<Uint8Array> {
    // Read compressed data from file
    const rawData = await this.loadDecompressed(id);
    if (rawData === null) {
      throw new Error(`Object not found: ${id}`);
    }
    // Apply offset/length if specified
    const start = params?.offset ?? 0;
    const end = params?.length ? start + params.length : rawData.length;
    yield rawData.subarray(start, end);
  }

  private async loadDecompressed(id: ObjectId): Promise<Uint8Array | null> {
    const path = getLooseObjectPath(this.objectsDir, id);
    if (!(await this.files.exists(path))) {
      return null;
    }
    // Read compressed data from file
    const compressedData = await this.files.readFile(path);
    // Decompress using zlib (raw: false for standard zlib header)
    return await decompressBlock(compressedData, { raw: false });
  }

  /**
   * Get object size
   */
  async getSize(id: ObjectId): Promise<number> {
    const rawData = await this.loadDecompressed(id);
    if (rawData === null) {
      return -1;
    }
    return rawData.length;
  }

  /**
   * Check if object exists
   */
  async has(id: ObjectId): Promise<boolean> {
    const path = getLooseObjectPath(this.objectsDir, id);
    return this.files.exists(path);
  }

  /**
   * Delete object
   *
   * Only deletes loose objects. Pack file objects cannot be deleted
   * without repacking.
   */
  async delete(id: ObjectId): Promise<boolean> {
    const path = getLooseObjectPath(this.objectsDir, id);
    return await this.files.remove(path);
  }

  /**
   * Close all pack readers
   */
  async close(): Promise<void> {}

  /**
   * Iterate over all object IDs in storage
   *
   * Reference: jgit LooseObjects.resolve()
   *
   * @returns AsyncGenerator yielding ObjectIds
   */
  async *listObjects(): AsyncGenerator<ObjectId> {
    // List all 2-character fanout directories
    const entries = await this.listDirectoryEntries(this.objectsDir);

    for (const entry of entries) {
      // Skip non-directories and special directories
      if (entry.kind !== "directory" || entry.name.length !== 2) {
        continue;
      }

      // Valid hex prefix?
      if (!/^[0-9a-f]{2}$/.test(entry.name)) {
        continue;
      }

      const prefix = entry.name;
      const subdir = joinPath(this.objectsDir, prefix);

      // List all files in the fanout directory
      const objects = await this.listDirectoryEntries(subdir);

      for (const obj of objects) {
        // Skip non-files and files with wrong suffix length
        if (obj.kind !== "file" || obj.name.length !== 38) {
          continue;
        }

        // Valid hex suffix?
        if (!/^[0-9a-f]{38}$/.test(obj.name)) {
          continue;
        }

        yield prefix + obj.name;
      }
    }
  }

  /**
   * Helper to list directory entries, returning empty array on error
   */
  private async listDirectoryEntries(path: string): Promise<FileInfo[]> {
    const entries: FileInfo[] = [];
    try {
      for await (const entry of this.files.list(path)) {
        entries.push(entry);
      }
    } catch {
      // Directory doesn't exist or other error
    }
    return entries;
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
