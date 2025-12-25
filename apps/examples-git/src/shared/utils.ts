/**
 * Shared utilities for Git pack file examples
 */

import * as fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { FilesApi, NodeFilesApi } from "@statewalker/webrun-files";
import { PackObjectType } from "@webrun-vcs/core";
import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";

// Set up Node.js compression (required for pack file operations)
setCompression(createNodeCompression());

/**
 * Create a FilesApi instance for the given base path
 */
export function createFilesApi(basePath?: string): FilesApi {
  const nodeFs = new NodeFilesApi({ fs, rootDir: basePath ?? "" });
  return new FilesApi(nodeFs);
}

/**
 * Human-readable names for pack object types
 */
export const TYPE_NAMES: Record<number, string> = {
  [PackObjectType.COMMIT]: "commit",
  [PackObjectType.TREE]: "tree",
  [PackObjectType.BLOB]: "blob",
  [PackObjectType.TAG]: "tag",
  [PackObjectType.OFS_DELTA]: "ofs_delta",
  [PackObjectType.REF_DELTA]: "ref_delta",
};

/**
 * Get human-readable type name
 */
export function getTypeName(type: PackObjectType): string {
  return TYPE_NAMES[type] ?? `unknown(${type})`;
}

/**
 * Format bytes as human-readable size
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Format hex string with abbreviated display
 */
export function formatId(id: string, length = 7): string {
  return id.substring(0, length);
}

/**
 * Convert Uint8Array to hex string
 */
export function toHex(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Decode bytes as UTF-8 text
 */
export function decodeText(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

/**
 * Get preview of content (first N characters)
 */
export function getContentPreview(content: Uint8Array, maxLength = 200): string {
  const text = decodeText(content);
  if (text.length <= maxLength) return text;
  return `${text.substring(0, maxLength)}...`;
}

/**
 * Check if content is likely text (not binary)
 */
export function isTextContent(content: Uint8Array): boolean {
  // Check for null bytes or other binary indicators
  for (let i = 0; i < Math.min(content.length, 512); i++) {
    const byte = content[i];
    // Control characters (except common ones like newline, tab, carriage return)
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      return false;
    }
  }
  return true;
}

/**
 * Get the index file path from a pack file path
 */
export function getIndexPath(packPath: string): string {
  if (packPath.endsWith(".pack")) {
    return `${packPath.slice(0, -5)}.idx`;
  }
  throw new Error(`Invalid pack path: ${packPath}`);
}

/**
 * Get the pack file path from an index file path
 */
export function getPackPath(idxPath: string): string {
  if (idxPath.endsWith(".idx")) {
    return `${idxPath.slice(0, -4)}.pack`;
  }
  throw new Error(`Invalid index path: ${idxPath}`);
}

/**
 * Resolve path relative to current working directory
 */
export function resolvePath(path: string): string {
  return resolve(process.cwd(), path);
}

/**
 * Get the directory containing a file
 */
export function getDir(path: string): string {
  return dirname(path);
}

/**
 * Parse command line arguments to get input file
 */
export function getInputFile(args: string[] = process.argv.slice(2)): string {
  if (args.length === 0) {
    throw new Error("Usage: example <pack-or-idx-file>");
  }
  return resolvePath(args[0]);
}

/**
 * Print a banner/header for the example
 */
export function printBanner(title: string): void {
  console.log(`\n=== ${title} ===\n`);
}

/**
 * Print section header
 */
export function printSection(title: string): void {
  console.log(`\n--- ${title} ---`);
}

/**
 * Print key-value info
 */
export function printInfo(key: string, value: string | number | boolean): void {
  console.log(`  ${key}: ${value}`);
}

/**
 * Compare two Uint8Arrays
 */
export function compareBytes(
  a: Uint8Array,
  b: Uint8Array,
): {
  equal: boolean;
  sizeDiff: number;
  firstMismatchIndex: number;
  mismatchCount: number;
} {
  const sizeDiff = a.length - b.length;
  const minLen = Math.min(a.length, b.length);
  let firstMismatchIndex = -1;
  let mismatchCount = 0;

  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) {
      if (firstMismatchIndex === -1) {
        firstMismatchIndex = i;
      }
      mismatchCount++;
    }
  }

  // Count remaining bytes in longer array as mismatches
  mismatchCount += Math.abs(sizeDiff);
  if (sizeDiff !== 0 && firstMismatchIndex === -1) {
    firstMismatchIndex = minLen;
  }

  return {
    equal: sizeDiff === 0 && mismatchCount === 0,
    sizeDiff,
    firstMismatchIndex,
    mismatchCount,
  };
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
