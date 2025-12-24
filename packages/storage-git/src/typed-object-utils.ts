/**
 * Typed object utilities
 *
 * Provides functions for storing and loading Git objects with type information.
 * These utilities work with LooseObjectStorage, allowing higher-level storage
 * classes to be independent of specific storage implementations.
 *
 * The storage interface stores and loads raw Git objects. These utilities
 * handle Git object format (header + content) on top of raw storage.
 */

import type { ObjectId, ObjectTypeCode } from "@webrun-vcs/core";
import { ObjectType } from "@webrun-vcs/core";
import { parseObjectHeader } from "./format/object-header.js";
import type { LooseObjectStorage } from "./git-delta-object-storage.js";

/**
 * Typed object data with type information
 */
export interface TypedObject {
  /** Object type code */
  type: ObjectTypeCode;
  /** Object content (without header) */
  content: Uint8Array;
  /** Content size */
  size: number;
}

/**
 * Store object with explicit type
 *
 * Creates proper Git object format with header and stores via storage.
 *
 * @param storage Storage instance (stores raw Git objects)
 * @param type Object type code
 * @param content Object content (without header)
 * @returns Object ID
 */
export async function storeTypedObject(
  storage: LooseObjectStorage,
  type: ObjectTypeCode,
  content: Uint8Array,
): Promise<ObjectId> {
  const typeStr = typeCodeToString(type);

  // Create Git object with header: "type size\0content"
  const header = new TextEncoder().encode(`${typeStr} ${content.length}\0`);
  const fullObject = new Uint8Array(header.length + content.length);
  fullObject.set(header, 0);
  fullObject.set(content, header.length);

  // Store the full object as raw bytes
  return storage.store([fullObject]);
}

/**
 * Load object with type information
 *
 * Loads raw object via storage and parses type from Git object header.
 *
 * @param storage Storage instance (loads raw Git objects)
 * @param id Object ID
 * @returns Typed object data
 */
export async function loadTypedObject(
  storage: LooseObjectStorage,
  id: ObjectId,
): Promise<TypedObject> {
  // Collect all chunks from the async iterable
  const chunks: Uint8Array[] = [];
  for await (const chunk of storage.load(id)) {
    chunks.push(chunk);
  }

  const rawData = concatUint8Arrays(chunks);

  // Parse header to get type and content offset
  const header = parseObjectHeader(rawData);

  // Extract content (after header)
  const content = rawData.subarray(header.contentOffset);

  return {
    type: header.typeCode,
    content,
    size: header.size,
  };
}

/**
 * Store a commit object
 */
export async function storeCommit(
  storage: LooseObjectStorage,
  content: Uint8Array,
): Promise<ObjectId> {
  return storeTypedObject(storage, ObjectType.COMMIT, content);
}

/**
 * Store a tree object
 */
export async function storeTree(
  storage: LooseObjectStorage,
  content: Uint8Array,
): Promise<ObjectId> {
  return storeTypedObject(storage, ObjectType.TREE, content);
}

/**
 * Store a blob object
 */
export async function storeBlob(
  storage: LooseObjectStorage,
  content: Uint8Array,
): Promise<ObjectId> {
  return storeTypedObject(storage, ObjectType.BLOB, content);
}

/**
 * Store a tag object
 */
export async function storeTag(
  storage: LooseObjectStorage,
  content: Uint8Array,
): Promise<ObjectId> {
  return storeTypedObject(storage, ObjectType.TAG, content);
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
