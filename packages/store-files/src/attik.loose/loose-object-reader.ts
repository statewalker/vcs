/**
 * Loose object reader
 *
 * Reads individual Git objects stored in .git/objects/XX/YYYYYY... format.
 * Each loose object is zlib-compressed and contains a header followed by content.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/LooseObjects.java
 */

import type { FilesApi } from "@statewalker/webrun-files";
import { decompressBlock } from "@webrun-vcs/utils";
import type { ObjectId, ObjectTypeCode } from "@webrun-vcs/vcs";
import { type ParsedObjectHeader, parseObjectHeader } from "../format/object-header.js";
import { getLooseObjectPath } from "../utils/file-utils.js";

// Re-export for backward compatibility
export { getLooseObjectPath };

/**
 * Result of reading a loose object
 */
export interface LooseObjectData {
  /** Object type code */
  typeCode: ObjectTypeCode;
  /** Object type string */
  type: string;
  /** Uncompressed size */
  size: number;
  /** Object content (without header) */
  content: Uint8Array;
}

/**
 * Check if a loose object exists
 *
 * @param files FilesApi instance
 * @param objectsDir Objects directory path
 * @param id Object ID
 * @returns True if the loose object exists
 */
export async function hasLooseObject(
  files: FilesApi,
  objectsDir: string,
  id: ObjectId,
): Promise<boolean> {
  const path = getLooseObjectPath(objectsDir, id);
  return files.exists(path);
}

/**
 * Read a loose object from disk
 *
 * @param files FilesApi instance
 * @param objectsDir Objects directory path
 * @param id Object ID
 * @returns Object data (type, size, content)
 * @throws Error if object not found or invalid format
 */
export async function readLooseObject(
  files: FilesApi,
  objectsDir: string,
  id: ObjectId,
): Promise<LooseObjectData> {
  const path = getLooseObjectPath(objectsDir, id);

  // Read compressed data
  const compressedData = await files.readFile(path);

  // Decompress (ZLIB format - raw: false)
  const rawData = await decompressBlock(compressedData, { raw: false });

  // Parse header
  const header = parseObjectHeader(rawData);

  // Extract content (after header)
  const content = rawData.subarray(header.contentOffset);

  // Verify size matches header
  if (content.length !== header.size) {
    throw new Error(
      `Loose object size mismatch for ${id}: ` +
        `header says ${header.size}, got ${content.length}`,
    );
  }

  return {
    typeCode: header.typeCode,
    type: header.type,
    size: header.size,
    content,
  };
}

/**
 * Read only the header of a loose object (without full decompression)
 *
 * This is more efficient when you only need type and size.
 * Note: We still need to decompress at least the header portion.
 *
 * @param files FilesApi instance
 * @param objectsDir Objects directory path
 * @param id Object ID
 * @returns Parsed header (type, size)
 */
export async function readLooseObjectHeader(
  files: FilesApi,
  objectsDir: string,
  id: ObjectId,
): Promise<ParsedObjectHeader> {
  // For now, we read the full object
  // A more efficient implementation could use streaming decompression
  const path = getLooseObjectPath(objectsDir, id);
  const compressedData = await files.readFile(path);
  const rawData = await decompressBlock(compressedData, { raw: false });
  return parseObjectHeader(rawData);
}

/**
 * Read raw loose object data (full Git format with header)
 *
 * Returns the complete decompressed Git object including the header.
 * Use this when you need the raw Git object format.
 *
 * @param files FilesApi instance
 * @param objectsDir Objects directory path
 * @param id Object ID
 * @returns Raw object data (header + content)
 */
export async function readRawLooseObject(
  files: FilesApi,
  objectsDir: string,
  id: ObjectId,
): Promise<Uint8Array> {
  const path = getLooseObjectPath(objectsDir, id);
  const compressedData = await files.readFile(path);
  return decompressBlock(compressedData, { raw: false });
}
