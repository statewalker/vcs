/**
 * Loose object writer
 *
 * Writes individual Git objects to .git/objects/XX/YYYYYY... format.
 * Each object is zlib-compressed with header: "type size\0content"
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/LooseObjects.java
 */

import { dirname, type FilesApi } from "@statewalker/webrun-files";
import { compressBlock } from "@webrun-vcs/compression";
import { sha1 } from "@webrun-vcs/hash/sha1";
import { bytesToHex } from "@webrun-vcs/hash/utils";
import type { ObjectId, ObjectTypeString } from "@webrun-vcs/storage";
import { createGitObject } from "../format/object-header.js";
import { atomicWriteFile, ensureDir } from "../utils/file-utils.js";
import { getLooseObjectPath, hasLooseObject } from "./loose-object-reader.js";

/**
 * Write a raw pre-formatted Git object to disk
 *
 * The object must already be in Git format (header + content).
 * The object ID is computed from the full object bytes.
 *
 * @param files FilesApi instance
 * @param objectsDir Objects directory path
 * @param fullObject Complete Git object (header + content)
 * @returns Object ID
 */
export async function writeRawLooseObject(
  files: FilesApi,
  objectsDir: string,
  fullObject: Uint8Array,
): Promise<ObjectId> {
  // Compute hash from the full object
  const id = bytesToHex(await sha1(fullObject));

  // Check if object already exists (deduplication)
  if (await hasLooseObject(files, objectsDir, id)) {
    return id;
  }

  // Compress the full object (ZLIB format - raw: false)
  const compressed = await compressBlock(fullObject, { raw: false });

  // Get path and ensure directory exists
  const path = getLooseObjectPath(objectsDir, id);
  const dir = dirname(path);
  await ensureDir(files, dir);

  // Write atomically
  await atomicWriteFile(files, path, compressed);

  return id;
}

/**
 * Write a loose object to disk
 *
 * The object ID is computed from the content. If an object with the
 * same ID already exists, this is a no-op (deduplication).
 *
 * @param files FilesApi instance
 * @param objectsDir Objects directory path
 * @param type Object type
 * @param content Object content (without header)
 * @returns Object ID
 */
export async function writeLooseObject(
  files: FilesApi,
  objectsDir: string,
  type: ObjectTypeString,
  content: Uint8Array,
): Promise<ObjectId> {
  // Create Git object with header
  const fullObject = createGitObject(type, content);

  // Compute hash
  const id = bytesToHex(await sha1(fullObject));

  // Check if object already exists (deduplication)
  if (await hasLooseObject(files, objectsDir, id)) {
    return id;
  }

  // Compress the full object (ZLIB format - raw: false)
  const compressed = await compressBlock(fullObject, { raw: false });

  // Get path and ensure directory exists
  const path = getLooseObjectPath(objectsDir, id);
  const dir = dirname(path);
  await ensureDir(files, dir);

  // Write atomically
  await atomicWriteFile(files, path, compressed);

  return id;
}
