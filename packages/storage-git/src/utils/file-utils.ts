/**
 * File utility functions for Git storage
 */

import type { FileApi } from "../file-api/types.js";

/**
 * Write a file atomically (via temp file + rename)
 *
 * This ensures that readers never see a partially written file.
 * If the write fails, the original file is left unchanged.
 *
 * @param files FileApi instance
 * @param path Destination path
 * @param content File content
 */
export async function atomicWriteFile(
  files: FileApi,
  path: string,
  content: Uint8Array,
): Promise<void> {
  // Create temp file in same directory
  const dir = files.dirname(path);
  const base = files.basename(path);
  const tempPath = files.join(dir, `.${base}.tmp.${Date.now()}`);

  try {
    // Write to temp file
    await files.writeFile(tempPath, content);

    // Atomically rename to final destination
    await files.rename(tempPath, path);
  } catch (error) {
    // Clean up temp file on failure
    try {
      await files.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Ensure a directory exists (create if needed)
 *
 * @param files FileApi instance
 * @param path Directory path
 */
export async function ensureDir(files: FileApi, path: string): Promise<void> {
  await files.mkdir(path);
}

/**
 * Read entire file or return undefined if not found
 *
 * @param files FileApi instance
 * @param path File path
 * @returns File content or undefined
 */
export async function tryReadFile(files: FileApi, path: string): Promise<Uint8Array | undefined> {
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
 * @param files FileApi instance
 * @param path Directory path
 * @yields Relative paths of all files
 */
export async function* listFilesRecursive(files: FileApi, path: string): AsyncGenerator<string> {
  const entries = await files.readdir(path);

  for (const entry of entries) {
    const fullPath = files.join(path, entry.name);

    if (entry.isFile) {
      yield fullPath;
    } else if (entry.isDirectory) {
      yield* listFilesRecursive(files, fullPath);
    }
  }
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
