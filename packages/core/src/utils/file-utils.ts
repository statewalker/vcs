/**
 * File utility functions for Git storage
 */

import { basename, dirname, type FilesApi, joinPath } from "../files/index.js";

/**
 * Write a file atomically (via temp file + rename)
 *
 * This ensures that readers never see a partially written file.
 * If the write fails, the original file is left unchanged.
 *
 * @param files FilesApi instance
 * @param path Destination path
 * @param content File content
 */
export async function atomicWriteFile(
  files: FilesApi,
  path: string,
  content: Uint8Array,
): Promise<void> {
  // Create temp file in same directory
  const dir = dirname(path);
  const base = basename(path);
  const tempPath = joinPath(dir, `.${base}.tmp.${Date.now()}`);

  try {
    // Write to temp file
    await files.write(tempPath, [content]);

    // Atomically rename to final destination
    await files.move(tempPath, path);
  } catch (error) {
    // Clean up temp file on failure
    try {
      await files.remove(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Ensure a directory exists (create if needed)
 *
 * @param files FilesApi instance
 * @param path Directory path
 */
export async function ensureDir(files: FilesApi, path: string): Promise<void> {
  await files.mkdir(path);
}

/**
 * Read entire file or return undefined if not found
 *
 * @param files FilesApi instance
 * @param path File path
 * @returns File content or undefined
 */
export async function tryReadFile(files: FilesApi, path: string): Promise<Uint8Array | undefined> {
  try {
    return await files.readFile(path);
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Check if an error is a "not found" error
 */
export function isNotFoundError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: string }).code === "ENOENT";
  }
  return false;
}

/**
 * List all files in a directory recursively
 *
 * @param files FilesApi instance
 * @param path Directory path
 * @yields Relative paths of all files
 */
export async function* listFilesRecursive(files: FilesApi, path: string): AsyncGenerator<string> {
  for await (const entry of files.list(path)) {
    const fullPath = joinPath(path, entry.name);

    if (entry.kind === "file") {
      yield fullPath;
    } else if (entry.kind === "directory") {
      yield* listFilesRecursive(files, fullPath);
    }
  }
}

// Re-export from hash package for backward compatibility
export { bytesToHex, hexToBytes } from "@webrun-vcs/utils/hash/utils";

/**
 * Get the file path for a loose object
 *
 * Loose objects are stored in a two-level directory structure:
 * - First 2 characters of hash -> directory name
 * - Remaining 38 characters -> filename
 *
 * Example: object "abc123..." is stored at "objects/ab/c123..."
 *
 * Reference: jgit LooseObjects.fileFor()
 *
 * @param objectsDir Objects directory path (.git/objects)
 * @param id Object ID (40-character hex string)
 * @returns Path to the loose object file
 */
export function getLooseObjectPath(objectsDir: string, id: string): string {
  const prefix = id.substring(0, 2);
  const suffix = id.substring(2);
  return joinPath(objectsDir, prefix, suffix);
}

/**
 * Concatenate multiple Uint8Arrays
 */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
