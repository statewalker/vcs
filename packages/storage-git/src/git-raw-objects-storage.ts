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

import {
  basename,
  dirname,
  type FileInfo,
  type FilesApi,
  joinPath,
} from "@statewalker/webrun-files";
import type { ObjectId, ObjectInfo, ObjectStorage } from "@webrun-vcs/storage";
import { bytesToHex, newSha1 } from "@/packages/hash";
import { getLooseObjectPath } from "./loose";

/**
 * Git object storage implementation
 *
 * Combines loose objects and pack files to provide the ObjectStorage interface.
 * Writes go to loose objects; reads check loose first, then pack files.
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
   * Store object content
   *
   * Content is hashed to produce the ObjectInfo. If an object with the
   * same hash already exists, this is a no-op (deduplication).
   *
   * Note: This stores content as a blob. For typed storage, use
   * storeTypedObject() from typed-object-utils.ts.
   */
  async store(data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectInfo> {
    const dir = dirname(this.objectsDir);
    const base = basename(this.objectsDir);
    const tempPath = joinPath(dir, `.${base}.tmp.${Date.now()}`);
    try {
      let length = 0;
      const hash = newSha1();
      const withHash = (async function* () {
        for await (const chunk of data) {
          hash.update(chunk);
          length += chunk.length;
          yield chunk;
        }
      })();
      // Write to temp file
      await this.files.write(tempPath, withHash);
      const id = bytesToHex(hash.finalize());
      const path = getLooseObjectPath(this.objectsDir, id);
      // Atomically rename to final destination
      await this.files.move(tempPath, path);
      return { id, size: length };
    } catch (error) {
      // Clean up temp file on failure
      try {
        await this.files.remove(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
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
