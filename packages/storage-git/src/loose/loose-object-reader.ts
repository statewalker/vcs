/**
 * Loose object reader
 *
 * Reads individual Git objects stored in .git/objects/XX/YYYYYY... format.
 * Each loose object is zlib-compressed and contains a header followed by content.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/LooseObjects.java
 */

import type { CompressionProvider } from "@webrun-vcs/common";
import type { ObjectId, ObjectTypeCode } from "@webrun-vcs/storage";
import type { FileApi } from "../file-api/types.js";
import { type ParsedObjectHeader, parseObjectHeader } from "../format/object-header.js";

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
 * Get the file path for a loose object
 *
 * @param objectsDir Objects directory path (.git/objects)
 * @param id Object ID (hex string)
 * @returns Path to the loose object file
 */
export function getLooseObjectPath(objectsDir: string, id: ObjectId, files: FileApi): string {
  const prefix = id.substring(0, 2);
  const suffix = id.substring(2);
  return files.join(objectsDir, prefix, suffix);
}

/**
 * Check if a loose object exists
 *
 * @param files FileApi instance
 * @param objectsDir Objects directory path
 * @param id Object ID
 * @returns True if the loose object exists
 */
export async function hasLooseObject(
  files: FileApi,
  objectsDir: string,
  id: ObjectId,
): Promise<boolean> {
  const path = getLooseObjectPath(objectsDir, id, files);
  return files.exists(path);
}

/**
 * Read a loose object from disk
 *
 * @param files FileApi instance
 * @param compression Compression provider
 * @param objectsDir Objects directory path
 * @param id Object ID
 * @returns Object data (type, size, content)
 * @throws Error if object not found or invalid format
 */
export async function readLooseObject(
  files: FileApi,
  compression: CompressionProvider,
  objectsDir: string,
  id: ObjectId,
): Promise<LooseObjectData> {
  const path = getLooseObjectPath(objectsDir, id, files);

  // Read compressed data
  const compressedData = await files.readFile(path);

  // Decompress
  const rawData = await compression.decompress(compressedData);

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
 * @param files FileApi instance
 * @param compression Compression provider
 * @param objectsDir Objects directory path
 * @param id Object ID
 * @returns Parsed header (type, size)
 */
export async function readLooseObjectHeader(
  files: FileApi,
  compression: CompressionProvider,
  objectsDir: string,
  id: ObjectId,
): Promise<ParsedObjectHeader> {
  // For now, we read the full object
  // A more efficient implementation could use streaming decompression
  const path = getLooseObjectPath(objectsDir, id, files);
  const compressedData = await files.readFile(path);
  const rawData = await compression.decompress(compressedData);
  return parseObjectHeader(rawData);
}
