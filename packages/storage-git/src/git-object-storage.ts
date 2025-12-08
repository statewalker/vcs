/**
 * Git object storage implementation
 *
 * Provides typed object storage on top of a raw ObjectStorage.
 * Uses utility functions for Git object format handling.
 *
 * This class wraps a raw ObjectStorage (which stores raw bytes) and provides
 * typed blob storage semantics. For full Git repository access including
 * pack files, use GitRawObjectStorage or a composite storage.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/ObjectDirectory.java
 */

import type { ObjectId, ObjectInfo, ObjectStorage } from "@webrun-vcs/storage";
import { ObjectType } from "@webrun-vcs/storage";
import { loadTypedObject, storeTypedObject } from "./typed-object-utils.js";

/**
 * Git object storage wrapping a raw ObjectStorage
 *
 * Implements the ObjectStorage interface for content-addressable storage.
 * The store() method stores content as blob objects.
 * The load() method returns content without Git headers.
 *
 * For typed object operations (commit, tree, tag), use the utility
 * functions from typed-object-utils.ts with this storage's rawStorage.
 */
export class GitObjectStorage implements ObjectStorage {
  private readonly rawStorage: ObjectStorage;

  constructor(rawStorage: ObjectStorage) {
    this.rawStorage = rawStorage;
  }

  /**
   * Get the underlying raw storage
   *
   * Use this with utility functions like storeTypedObject() and loadTypedObject()
   * for storing non-blob objects.
   */
  getRawStorage(): ObjectStorage {
    return this.rawStorage;
  }

  /**
   * Store object content as a blob
   *
   * Content is wrapped in Git blob format and stored.
   * For other object types, use storeTypedObject() with getRawStorage().
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

    // Store as blob using utility function
    const id = await storeTypedObject(this.rawStorage, ObjectType.BLOB, content);
    return { id, size: content.length };
  }

  /**
   * Load object content by ID
   *
   * Returns content without the Git header.
   * For typed objects with header parsing, use loadTypedObject() with getRawStorage().
   */
  async *load(
    id: ObjectId,
    params?: { offset?: number; length?: number },
  ): AsyncIterable<Uint8Array> {
    const obj = await loadTypedObject(this.rawStorage, id);
    const content = obj.content;

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
   * Get object metadata
   */
  async getInfo(id: ObjectId): Promise<ObjectInfo | null> {
    const info = await this.rawStorage.getInfo(id);
    if (!info) {
      return null;
    }

    // Load to get actual content size (without header)
    try {
      const obj = await loadTypedObject(this.rawStorage, id);
      return { id, size: obj.size };
    } catch {
      return null;
    }
  }

  /**
   * Delete object
   */
  async delete(id: ObjectId): Promise<boolean> {
    return this.rawStorage.delete(id);
  }

  /**
   * Close storage
   */
  async close(): Promise<void> {
    // Raw storage may have close method
    if ("close" in this.rawStorage && typeof this.rawStorage.close === "function") {
      await this.rawStorage.close();
    }
  }

  /**
   * Iterate over all objects in storage
   *
   * @returns AsyncGenerator yielding ObjectInfos
   */
  async *listObjects(): AsyncGenerator<ObjectInfo> {
    for await (const info of this.rawStorage.listObjects()) {
      // Get actual content size
      try {
        const obj = await loadTypedObject(this.rawStorage, info.id);
        yield { id: info.id, size: obj.size };
      } catch {
        // Skip invalid objects
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
