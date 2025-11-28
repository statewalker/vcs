/**
 * Git-compatible object storage wrapper
 *
 * Wraps any ObjectStorage implementation to add Git-style type headers.
 * The underlying storage should be configured with SHA-1 for full Git compatibility.
 *
 * Git object format: "<type> <size>\0<content>"
 * Where type is one of: commit, tree, blob, tag
 */

import type { ObjectId, ObjectStorage } from "../storage/index.js";
import {
  concatArrays,
  encodeHeader,
  type ObjectTypeCode,
  parseHeaderFromStream,
} from "./git-format.js";

export { ObjectType, type ObjectTypeCode } from "./git-format.js";

/**
 * Typed object returned when loading from GitObjectStorage
 */
export interface TypedObject {
  /** Git object type code */
  type: ObjectTypeCode;
  /** Content size in bytes (from header) */
  size: number;
  /** Content stream (without header) */
  content: AsyncIterable<Uint8Array>;
}

/**
 * Git-compatible object storage wrapper
 *
 * Wraps any ObjectStorage to add Git-style type headers.
 * The underlying storage should be configured with SHA-1 for Git compatibility.
 *
 * @example
 * ```typescript
 * // Create base storage with SHA-1 for Git compatibility
 * const baseStorage = createDefaultObjectStorage({ hashAlgorithm: 'SHA-1' });
 *
 * // Wrap with Git semantics
 * const gitStorage = new GitObjectStorage(baseStorage);
 *
 * // Store a blob
 * const content = new TextEncoder().encode('Hello, World!');
 * const blobId = await gitStorage.storeTypedBytes(ObjectType.BLOB, content);
 *
 * // Load with type info
 * const { type, size, content } = await gitStorage.loadTypedBytes(blobId);
 * ```
 */
export class GitObjectStorage {
  constructor(private readonly storage: ObjectStorage) {}

  /**
   * Store typed object with Git header format
   *
   * Prepends "<type> <size>\0" header to content before storing.
   * The ObjectId is computed by the underlying storage over the full
   * header + content, which matches Git's behavior when using SHA-1.
   *
   * @param type Git object type (COMMIT, TREE, BLOB, or TAG)
   * @param content Content data as async iterable
   * @returns ObjectId (hash of header + content)
   */
  async storeTyped(type: ObjectTypeCode, content: AsyncIterable<Uint8Array>): Promise<ObjectId> {
    // Collect content to compute size for header
    const chunks: Uint8Array[] = [];
    for await (const chunk of content) {
      chunks.push(chunk);
    }
    const contentData = concatArrays(chunks);

    // Create header with type and size
    const header = encodeHeader(type, contentData.length);

    // Store header + content
    const withHeader = (async function* () {
      yield header;
      yield contentData;
    })();

    return this.storage.store(withHeader);
  }

  /**
   * Store typed object from a Uint8Array
   *
   * Convenience method for storing content that's already in memory.
   *
   * @param type Git object type
   * @param content Content data
   * @returns ObjectId
   */
  async storeTypedBytes(type: ObjectTypeCode, content: Uint8Array): Promise<ObjectId> {
    return this.storeTyped(type, toAsyncIterable(content));
  }

  /**
   * Load object and parse Git header
   *
   * Returns the object type, declared size, and content stream.
   *
   * @param id ObjectId to load
   * @returns Typed object with type, size, and content stream
   */
  async loadTyped(id: ObjectId): Promise<TypedObject> {
    const stream = this.storage.load(id);
    return parseHeaderFromStream(stream);
  }

  /**
   * Load typed object and collect content into bytes
   *
   * Convenience method that loads and collects all content into a Uint8Array.
   *
   * @param id ObjectId to load
   * @returns Typed object with type, size, and content as Uint8Array
   */
  async loadTypedBytes(id: ObjectId): Promise<{
    type: ObjectTypeCode;
    size: number;
    content: Uint8Array;
  }> {
    const { type, size, content } = await this.loadTyped(id);
    const chunks: Uint8Array[] = [];
    for await (const chunk of content) {
      chunks.push(chunk);
    }
    return {
      type,
      size,
      content: concatArrays(chunks),
    };
  }

  /**
   * Check if object exists
   *
   * Delegates directly to underlying storage.
   *
   * @param id ObjectId to check
   * @returns True if object exists
   */
  has(id: ObjectId): Promise<boolean> {
    return this.storage.has(id);
  }

  /**
   * Delete object
   *
   * Delegates directly to underlying storage.
   *
   * @param id ObjectId to delete
   * @returns True if object was deleted
   */
  delete(id: ObjectId): Promise<boolean> {
    return this.storage.delete(id);
  }

  /**
   * Access the underlying raw storage
   *
   * Use this for operations that don't need Git type headers,
   * or for accessing storage-specific features like deltification.
   */
  get raw(): ObjectStorage {
    return this.storage;
  }
}

/**
 * Helper to convert a Uint8Array to AsyncIterable
 */
export function toAsyncIterable(data: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield data;
  })();
}
