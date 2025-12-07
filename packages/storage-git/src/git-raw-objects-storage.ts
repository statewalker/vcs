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
import { sha1 } from "@webrun-vcs/hash/sha1";
import { bytesToHex } from "@webrun-vcs/hash/utils";
import type { ObjectId, ObjectInfo, ObjectStorage } from "@webrun-vcs/storage";
import { getLooseObjectPath } from "./loose/index.js";

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
   * Store raw content
   *
   * Content is hashed to produce the ObjectInfo. If an object with the
   * same hash already exists, this is a no-op (deduplication).
   *
   * This stores raw bytes as-is. For Git objects with headers,
   * the caller must include the header in the data.
   */
  async store(data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectInfo> {
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

    // Hash the content
    const id = bytesToHex(await sha1(content));
    const path = getLooseObjectPath(this.objectsDir, id);

    // Write to file (FilesApi handles atomic write)
    await this.files.write(path, [content]);

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
    const path = getLooseObjectPath(this.objectsDir, id);
    const handler = await this.files.open(path);
    try {
      const start = params?.offset ?? 0;
      const end = params?.length ? start + params.length : undefined;
      yield* handler.createReadStream({ start, end });
    } finally {
      await handler.close();
    }
  }

  /**
   * Get object metadata
   */
  async getInfo(id: ObjectId): Promise<ObjectInfo | null> {
    const path = getLooseObjectPath(this.objectsDir, id);
    const stats = await this.files.stats(path);
    if (stats) {
      return { id, size: stats.size ?? 0 };
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
    const path = getLooseObjectPath(this.objectsDir, id);
    return await this.files.remove(path);
  }

  /**
   * Close all pack readers
   */
  async close(): Promise<void> {}

  /**
   * Iterate over all objects in storage
   *
   * @returns AsyncGenerator yielding ObjectInfos
   */
  async *listObjects(): AsyncGenerator<ObjectInfo> {
    // List all 2-character subdirectories
    const entries: FileInfo[] = [];
    try {
      for await (const entry of this.files.list(this.objectsDir)) {
        entries.push(entry);
      }
    } catch {
      return; // Objects directory doesn't exist
    }

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

      const objects: FileInfo[] = [];
      try {
        for await (const obj of this.files.list(subdir)) {
          objects.push(obj);
        }
      } catch {
        continue;
      }

      for (const obj of objects) {
        if (obj.kind !== "file" || obj.name.length !== 38) {
          continue;
        }

        // Valid hex suffix?
        if (!/^[0-9a-f]{38}$/.test(obj.name)) {
          continue;
        }

        yield {
          id: prefix + obj.name,
          size: obj.size ?? 0,
        };
      }
    }
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
