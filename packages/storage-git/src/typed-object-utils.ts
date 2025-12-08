/**
 * Typed object utilities
 *
 * Provides functions for storing and loading Git objects with type information.
 * These utilities work with TypedObjectStorage, allowing higher-level storage
 * classes to be independent of GitObjectStorage concrete implementation.
 */

import type { ObjectId, ObjectStorage, ObjectTypeCode } from "@webrun-vcs/storage";
import { ObjectType } from "@webrun-vcs/storage";
import { parseObjectHeader } from "./format/object-header.js";

/**
 * Extended ObjectStorage interface with raw Git object methods
 *
 * This interface extends ObjectStorage with methods needed for typed object
 * operations. GitObjectStorage implements this interface.
 */
export interface TypedObjectStorage extends ObjectStorage {
  /**
   * Store raw Git object data (with header)
   *
   * @param fullObject Complete Git object (header + content)
   * @returns Object ID
   */
  storeRaw(fullObject: Uint8Array): Promise<ObjectId>;

  /**
   * Load raw Git object data (with header)
   *
   * @param id Object ID
   * @returns Raw object data (header + content)
   */
  loadRaw(id: ObjectId): Promise<Uint8Array>;
}

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
 * Creates proper Git object format with header and stores via TypedObjectStorage.
 *
 * @param storage TypedObjectStorage instance
 * @param type Object type code
 * @param content Object content (without header)
 * @returns Object ID
 */
export async function storeTypedObject(
  storage: TypedObjectStorage,
  type: ObjectTypeCode,
  content: Uint8Array,
): Promise<ObjectId> {
  const typeStr = typeCodeToString(type);

  // Create Git object with header: "type size\0content"
  const header = new TextEncoder().encode(`${typeStr} ${content.length}\0`);
  const fullObject = new Uint8Array(header.length + content.length);
  fullObject.set(header, 0);
  fullObject.set(content, header.length);

  return storage.storeRaw(fullObject);
}

/**
 * Load object with type information
 *
 * Loads raw object via TypedObjectStorage and parses type from Git object header.
 *
 * @param storage TypedObjectStorage instance
 * @param id Object ID
 * @returns Typed object data
 */
export async function loadTypedObject(
  storage: TypedObjectStorage,
  id: ObjectId,
): Promise<TypedObject> {
  // Load raw object data (with header)
  const rawData = await storage.loadRaw(id);

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
  storage: TypedObjectStorage,
  content: Uint8Array,
): Promise<ObjectId> {
  return storeTypedObject(storage, ObjectType.COMMIT, content);
}

/**
 * Store a tree object
 */
export async function storeTree(
  storage: TypedObjectStorage,
  content: Uint8Array,
): Promise<ObjectId> {
  return storeTypedObject(storage, ObjectType.TREE, content);
}

/**
 * Store a blob object
 */
export async function storeBlob(
  storage: TypedObjectStorage,
  content: Uint8Array,
): Promise<ObjectId> {
  return storeTypedObject(storage, ObjectType.BLOB, content);
}

/**
 * Store a tag object
 */
export async function storeTag(
  storage: TypedObjectStorage,
  content: Uint8Array,
): Promise<ObjectId> {
  return storeTypedObject(storage, ObjectType.TAG, content);
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
