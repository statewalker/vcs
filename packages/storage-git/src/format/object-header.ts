/**
 * Git object header encoding/decoding
 *
 * Git objects are stored with a header: "type size\0content"
 * where type is "blob", "tree", "commit", or "tag" and size is decimal.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/Constants.java
 */

import type { ObjectTypeCode, ObjectTypeString } from "@webrun-vcs/storage";
import { ObjectType } from "@webrun-vcs/storage";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Null byte for header termination */
const NULL_BYTE = 0;

/**
 * Convert object type code to string
 */
export function typeCodeToString(code: ObjectTypeCode): ObjectTypeString {
  switch (code) {
    case ObjectType.COMMIT:
      return "commit";
    case ObjectType.TREE:
      return "tree";
    case ObjectType.BLOB:
      return "blob";
    case ObjectType.TAG:
      return "tag";
    default:
      throw new Error(`Unknown object type code: ${code}`);
  }
}

/**
 * Convert object type string to code
 */
export function typeStringToCode(type: ObjectTypeString): ObjectTypeCode {
  switch (type) {
    case "commit":
      return ObjectType.COMMIT;
    case "tree":
      return ObjectType.TREE;
    case "blob":
      return ObjectType.BLOB;
    case "tag":
      return ObjectType.TAG;
    default:
      throw new Error(`Unknown object type: ${type}`);
  }
}

/**
 * Encode a Git object header
 *
 * Format: "type size\0"
 *
 * @param type Object type string
 * @param size Content size in bytes
 * @returns Encoded header as Uint8Array
 */
export function encodeObjectHeader(type: ObjectTypeString, size: number): Uint8Array {
  return encoder.encode(`${type} ${size}\0`);
}

/**
 * Encode a Git object header using type code
 *
 * @param typeCode Object type code
 * @param size Content size in bytes
 * @returns Encoded header as Uint8Array
 */
export function encodeObjectHeaderFromCode(typeCode: ObjectTypeCode, size: number): Uint8Array {
  return encodeObjectHeader(typeCodeToString(typeCode), size);
}

/**
 * Parsed object header
 */
export interface ParsedObjectHeader {
  /** Object type string */
  type: ObjectTypeString;
  /** Object type code */
  typeCode: ObjectTypeCode;
  /** Content size in bytes */
  size: number;
  /** Offset where content starts (after null byte) */
  contentOffset: number;
}

/**
 * Parse a Git object header
 *
 * @param data Raw object data (including header)
 * @returns Parsed header with type, size, and content offset
 * @throws Error if header is malformed
 */
export function parseObjectHeader(data: Uint8Array): ParsedObjectHeader {
  // Find the null byte that terminates the header
  let nullPos = -1;
  for (let i = 0; i < Math.min(data.length, 32); i++) {
    if (data[i] === NULL_BYTE) {
      nullPos = i;
      break;
    }
  }

  if (nullPos === -1) {
    throw new Error("Invalid object header: no null byte found");
  }

  // Decode header as UTF-8
  const header = decoder.decode(data.subarray(0, nullPos));

  // Split into type and size
  const spacePos = header.indexOf(" ");
  if (spacePos === -1) {
    throw new Error("Invalid object header: no space found");
  }

  const typeStr = header.substring(0, spacePos);
  const sizeStr = header.substring(spacePos + 1);

  // Validate type
  if (!["blob", "tree", "commit", "tag"].includes(typeStr)) {
    throw new Error(`Invalid object type: ${typeStr}`);
  }

  // Parse size
  const size = parseInt(sizeStr, 10);
  if (Number.isNaN(size) || size < 0) {
    throw new Error(`Invalid object size: ${sizeStr}`);
  }

  const type = typeStr as ObjectTypeString;

  return {
    type,
    typeCode: typeStringToCode(type),
    size,
    contentOffset: nullPos + 1,
  };
}

/**
 * Create a full Git object (header + content)
 *
 * @param type Object type string
 * @param content Object content
 * @returns Full object with header
 */
export function createGitObject(type: ObjectTypeString, content: Uint8Array): Uint8Array {
  const header = encodeObjectHeader(type, content.length);
  const result = new Uint8Array(header.length + content.length);
  result.set(header, 0);
  result.set(content, header.length);
  return result;
}

/**
 * Extract content from a Git object (strips header)
 *
 * @param data Full object data with header
 * @returns Object content without header
 */
export function extractGitObjectContent(data: Uint8Array): Uint8Array {
  const header = parseObjectHeader(data);
  return data.subarray(header.contentOffset);
}
