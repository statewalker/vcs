/**
 * Loose object writer
 *
 * Writes individual Git objects to .git/objects/XX/YYYYYY... format.
 * Each object is zlib-compressed with header: "type size\0content"
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/LooseObjects.java
 */

import { compressBlock, sha1 } from "@webrun-vcs/common";
import type { ObjectId, ObjectTypeString } from "@webrun-vcs/storage";
import type { GitFilesApi } from "../git-files-api.js";
import { createGitObject } from "../format/object-header.js";
import { atomicWriteFile, ensureDir } from "../utils/file-utils.js";
import { getLooseObjectPath, hasLooseObject } from "./loose-object-reader.js";

/**
 * Write a loose object to disk
 *
 * The object ID is computed from the content. If an object with the
 * same ID already exists, this is a no-op (deduplication).
 *
 * @param files GitFilesApi instance
 * @param objectsDir Objects directory path
 * @param type Object type
 * @param content Object content (without header)
 * @returns Object ID
 */
export async function writeLooseObject(
  files: GitFilesApi,
  objectsDir: string,
  type: ObjectTypeString,
  content: Uint8Array,
): Promise<ObjectId> {
  // Create Git object with header
  const fullObject = createGitObject(type, content);

  // Compute hash
  const id = await sha1(fullObject);

  // Check if object already exists (deduplication)
  if (await hasLooseObject(files, objectsDir, id)) {
    return id;
  }

  // Compress the full object (ZLIB format - raw: false)
  const compressed = await compressBlock(fullObject, { raw: false });

  // Get path and ensure directory exists
  const path = getLooseObjectPath(objectsDir, id, files);
  const dir = files.dirname(path);
  await ensureDir(files, dir);

  // Write atomically
  await atomicWriteFile(files, path, compressed);

  return id;
}
