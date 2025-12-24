/**
 * File-based loose object storage
 *
 * Implements LooseObjectStorage interface for Git-compatible loose objects.
 * Uses zlib compression and the standard Git loose object format.
 *
 * This replaces the deprecated GitRawObjectStorage class.
 */

import type { FilesApi } from "@statewalker/webrun-files";
import type { ObjectId } from "@webrun-vcs/core";
import type { LooseObjectStorage } from "../git-delta-object-storage.js";
import { getLooseObjectPath } from "../utils/file-utils.js";
import { hasLooseObject, readRawLooseObject } from "./loose-object-reader.js";
import { writeRawLooseObject } from "./loose-object-writer.js";

/**
 * File-based loose object storage
 *
 * Stores Git objects as compressed files in the standard Git format:
 * .git/objects/XX/YYYYYY... (where XX is first 2 chars of SHA-1)
 */
export class FileLooseObjectStorage implements LooseObjectStorage {
  private readonly files: FilesApi;
  private readonly objectsDir: string;

  constructor(files: FilesApi, gitDir: string) {
    this.files = files;
    this.objectsDir = `${gitDir}/objects`;
  }

  /**
   * Store content and return object ID
   *
   * The content must be a complete Git object (header + content).
   * SHA-1 hash is computed and used as the object ID.
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
    return writeRawLooseObject(this.files, this.objectsDir, content);
  }

  /**
   * Load content by ID
   *
   * Returns the full Git object (header + content).
   */
  async *load(
    id: ObjectId,
    params?: { offset?: number; length?: number },
  ): AsyncIterable<Uint8Array> {
    const rawData = await readRawLooseObject(this.files, this.objectsDir, id);

    // Apply offset and length if specified
    const offset = params?.offset ?? 0;
    const length = params?.length ?? rawData.length - offset;
    const end = Math.min(offset + length, rawData.length);

    if (offset >= rawData.length) {
      return;
    }

    yield rawData.subarray(offset, end);
  }

  /**
   * Check if object exists
   */
  async has(id: ObjectId): Promise<boolean> {
    return hasLooseObject(this.files, this.objectsDir, id);
  }

  /**
   * Delete object
   */
  async delete(id: ObjectId): Promise<boolean> {
    const path = getLooseObjectPath(this.objectsDir, id);
    try {
      await this.files.remove(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all object IDs
   */
  async *listObjects(): AsyncIterable<ObjectId> {
    // List all 2-character fanout directories
    try {
      for await (const entry of this.files.list(this.objectsDir)) {
        // Skip non-directories and special directories
        if (entry.kind !== "directory" || entry.name.length !== 2) {
          continue;
        }

        // Valid hex prefix?
        if (!/^[0-9a-f]{2}$/.test(entry.name)) {
          continue;
        }

        const prefix = entry.name;
        const subdir = `${this.objectsDir}/${prefix}`;

        // List all files in the fanout directory
        try {
          for await (const obj of this.files.list(subdir)) {
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
        } catch {
          // Skip inaccessible directories
        }
      }
    } catch {
      // Objects directory doesn't exist or is inaccessible
    }
  }

  /**
   * Get object size
   *
   * Returns the uncompressed size of the Git object.
   */
  async getSize(id: ObjectId): Promise<number> {
    try {
      const rawData = await readRawLooseObject(this.files, this.objectsDir, id);
      return rawData.length;
    } catch {
      return -1;
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

/**
 * Create a file-based loose object storage
 */
export function createFileLooseObjectStorage(
  files: FilesApi,
  gitDir: string,
): FileLooseObjectStorage {
  return new FileLooseObjectStorage(files, gitDir);
}
