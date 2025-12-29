/**
 * Git tree object format serialization and parsing
 *
 * @deprecated This module is deprecated. Import from @webrun-vcs/core/format instead.
 *
 * Tree format: sequence of entries, each entry is:
 *   mode SP name NUL sha1
 *
 * Where:
 * - mode is octal digits (no leading zeros except for trees which use 40000)
 * - SP is a space (0x20)
 * - name is UTF-8 encoded filename
 * - NUL is null byte (0x00)
 * - sha1 is 20 raw bytes
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/TreeFormatter.java
 */

import type { TreeEntry } from "@webrun-vcs/core";
import { FileMode, GitFormat } from "@webrun-vcs/core";
import { bytesToHex, hexToBytes } from "@webrun-vcs/utils/hash/utils";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SPACE = 0x20;
const NULL = 0x00;
const OBJECT_ID_LENGTH = GitFormat.OBJECT_ID_LENGTH; // 20 bytes

/**
 * Encode file mode as octal ASCII bytes (no leading zeros)
 *
 * Git stores mode as octal digits without leading zeros,
 * except directories which are stored as "40000".
 */
function encodeMode(mode: number): Uint8Array {
  // Convert to octal string, removing leading zeros
  const octal = mode.toString(8);

  // Trees are special - they use 40000 (with leading zero preserved in certain contexts)
  // but actually Git normalizes to no leading zeros
  // Regular files: 100644, 100755
  // Symlinks: 120000
  // Gitlinks: 160000
  // Trees: 40000

  return encoder.encode(octal);
}

/**
 * Parse file mode from octal ASCII bytes
 */
function parseMode(bytes: Uint8Array): number {
  const str = decoder.decode(bytes);
  return parseInt(str, 8);
}

/**
 * Compare tree entries for canonical sorting
 *
 * Git sorts tree entries by name, treating directories as if
 * they have a trailing slash for comparison purposes.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/TreeFormatter.java
 */
export function compareTreeEntries(a: TreeEntry, b: TreeEntry): number {
  const aName = a.name;
  const bName = b.name;
  const aIsTree = isTreeMode(a.mode);
  const bIsTree = isTreeMode(b.mode);

  // Compare byte by byte, treating trees as having trailing '/'
  const aBytes = encoder.encode(aName);
  const bBytes = encoder.encode(bName);

  const len = Math.min(aBytes.length, bBytes.length);
  for (let i = 0; i < len; i++) {
    const diff = aBytes[i] - bBytes[i];
    if (diff !== 0) return diff;
  }

  // If we get here, one is a prefix of the other
  // Trees are compared as if they have trailing '/'
  const aLen = aIsTree ? aBytes.length + 1 : aBytes.length;
  const bLen = bIsTree ? bBytes.length + 1 : bBytes.length;

  if (aLen === bLen) return 0;

  // Compare the character at the shorter length position
  const aChar = aBytes.length > len ? aBytes[len] : aIsTree ? 0x2f /* '/' */ : 0;
  const bChar = bBytes.length > len ? bBytes[len] : bIsTree ? 0x2f /* '/' */ : 0;

  return aChar - bChar;
}

/**
 * Check if mode represents a tree (directory)
 */
function isTreeMode(mode: number): boolean {
  return (mode & 0o170000) === FileMode.TREE;
}

/**
 * Validate tree entry name
 *
 * Based on: jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/ObjectChecker.java#checkPathSegment
 *
 * @param name Entry name to validate
 * @throws Error if name is invalid
 */
function validateEntryName(name: string): void {
  if (name === "") {
    throw new Error("Tree entry name cannot be empty");
  }
  if (name === "." || name === "..") {
    throw new Error(`Tree entry name cannot be '${name}'`);
  }
  if (name.includes("/")) {
    throw new Error("Tree entry name cannot contain '/'");
  }
  if (name.includes("\0")) {
    throw new Error("Tree entry name cannot contain null bytes");
  }
}

/**
 * Serialize tree entries to Git tree format
 *
 * Entries must be sorted in canonical order before calling this function,
 * or pass unsorted entries and let the function sort them.
 *
 * Based on: jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/TreeFormatter.java
 *
 * @param entries Tree entries (will be sorted if not already)
 * @returns Serialized tree content (without header)
 * @throws Error if any entry has an invalid name
 */
export function serializeTree(entries: TreeEntry[]): Uint8Array {
  // Validate all entry names first
  for (const entry of entries) {
    validateEntryName(entry.name);
  }

  // Sort entries in canonical order
  const sorted = [...entries].sort(compareTreeEntries);

  // Calculate total size
  let totalSize = 0;
  const encodedEntries: { mode: Uint8Array; name: Uint8Array; id: Uint8Array }[] = [];

  for (const entry of sorted) {
    const mode = encodeMode(entry.mode);
    const name = encoder.encode(entry.name);
    const id = hexToBytes(entry.id);

    if (id.length !== OBJECT_ID_LENGTH) {
      throw new Error(`Invalid object ID length: ${entry.id}`);
    }

    encodedEntries.push({ mode, name, id });
    totalSize += mode.length + 1 + name.length + 1 + OBJECT_ID_LENGTH;
  }

  // Build result
  const result = new Uint8Array(totalSize);
  let offset = 0;

  for (const { mode, name, id } of encodedEntries) {
    result.set(mode, offset);
    offset += mode.length;

    result[offset] = SPACE;
    offset += 1;

    result.set(name, offset);
    offset += name.length;

    result[offset] = NULL;
    offset += 1;

    result.set(id, offset);
    offset += OBJECT_ID_LENGTH;
  }

  return result;
}

/**
 * Parse tree entries from Git tree format
 *
 * @param data Serialized tree content (without header)
 * @returns Generator yielding tree entries in order
 */
export function* parseTree(data: Uint8Array): Generator<TreeEntry> {
  let offset = 0;

  while (offset < data.length) {
    // Find space after mode
    let spacePos = offset;
    while (spacePos < data.length && data[spacePos] !== SPACE) {
      spacePos++;
    }

    if (spacePos >= data.length) {
      throw new Error("Invalid tree format: no space after mode");
    }

    const mode = parseMode(data.subarray(offset, spacePos));
    offset = spacePos + 1;

    // Find null after name
    let nullPos = offset;
    while (nullPos < data.length && data[nullPos] !== NULL) {
      nullPos++;
    }

    if (nullPos >= data.length) {
      throw new Error("Invalid tree format: no null after name");
    }

    const name = decoder.decode(data.subarray(offset, nullPos));
    offset = nullPos + 1;

    // Read object ID
    if (offset + OBJECT_ID_LENGTH > data.length) {
      throw new Error("Invalid tree format: truncated object ID");
    }

    const id = bytesToHex(data.subarray(offset, offset + OBJECT_ID_LENGTH));
    offset += OBJECT_ID_LENGTH;

    yield { mode, name, id };
  }
}

/**
 * Parse tree entries to array
 *
 * @param data Serialized tree content (without header)
 * @returns Array of tree entries
 */
export function parseTreeToArray(data: Uint8Array): TreeEntry[] {
  return Array.from(parseTree(data));
}

/**
 * Find entry by name in tree data
 *
 * Uses binary search for efficiency on large trees.
 *
 * @param data Serialized tree content
 * @param targetName Name to find
 * @returns Tree entry or undefined if not found
 */
export function findTreeEntry(data: Uint8Array, targetName: string): TreeEntry | undefined {
  // For simplicity, iterate through entries
  // A more efficient implementation would use binary search
  for (const entry of parseTree(data)) {
    if (entry.name === targetName) {
      return entry;
    }
    // Since entries are sorted, we can stop early if we've passed the target
    if (compareTreeEntries({ mode: 0, name: targetName, id: "" }, entry) < 0) {
      break;
    }
  }
  return undefined;
}

/**
 * Well-known empty tree SHA-1 hash
 */
export const EMPTY_TREE_ID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
