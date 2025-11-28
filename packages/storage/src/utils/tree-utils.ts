import type { TreeEntry } from "../file-tree-storage.js";
import { FileMode } from "../types.js";

/**
 * Collect tree entries from async iterable into array
 *
 * Use when you need all entries in memory (e.g., for manipulation).
 *
 * @param entries AsyncIterable of tree entries
 * @returns Array of tree entries
 */
export async function collectTreeEntries(
  entries: AsyncIterable<TreeEntry>,
): Promise<TreeEntry[]> {
  const result: TreeEntry[] = [];
  for await (const entry of entries) {
    result.push(entry);
  }
  return result;
}

/**
 * Convert array to async iterable
 *
 * Use when you have entries in memory and need to pass to storeTree.
 *
 * @param entries Array of tree entries
 * @returns AsyncIterable of tree entries
 */
export async function* iterateTreeEntries(
  entries: TreeEntry[],
): AsyncIterable<TreeEntry> {
  for (const entry of entries) {
    yield entry;
  }
}

/**
 * Check if mode represents a tree (directory)
 */
export function isTreeMode(mode: number): boolean {
  return (mode & 0o170000) === FileMode.TREE;
}

/**
 * Compare tree entries in Git canonical order
 *
 * Git sorts tree entries by name, but directories are compared
 * as if they had a trailing '/'. This ensures consistent hashing.
 *
 * @param a First entry
 * @param b Second entry
 * @returns Negative if a < b, positive if a > b, zero if equal
 */
export function compareTreeEntries(a: TreeEntry, b: TreeEntry): number {
  // For sorting, directories are compared as if they end with '/'
  const aName = isTreeMode(a.mode) ? a.name + "/" : a.name;
  const bName = isTreeMode(b.mode) ? b.name + "/" : b.name;

  // Byte-by-byte comparison (UTF-8)
  const aBytes = new TextEncoder().encode(aName);
  const bBytes = new TextEncoder().encode(bName);
  const minLen = Math.min(aBytes.length, bBytes.length);

  for (let i = 0; i < minLen; i++) {
    if (aBytes[i] !== bBytes[i]) {
      return aBytes[i] - bBytes[i];
    }
  }

  return aBytes.length - bBytes.length;
}

/**
 * Sort tree entries in Git canonical order
 *
 * @param entries Array of tree entries
 * @returns New sorted array (does not modify original)
 */
export function sortTreeEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort(compareTreeEntries);
}

/**
 * Filter tree entries by predicate
 *
 * @param entries AsyncIterable of tree entries
 * @param predicate Filter function
 * @returns AsyncIterable of filtered entries
 */
export async function* filterTreeEntries(
  entries: AsyncIterable<TreeEntry>,
  predicate: (entry: TreeEntry) => boolean,
): AsyncIterable<TreeEntry> {
  for await (const entry of entries) {
    if (predicate(entry)) {
      yield entry;
    }
  }
}

/**
 * Map tree entries
 *
 * @param entries AsyncIterable of tree entries
 * @param mapper Transform function
 * @returns AsyncIterable of transformed entries
 */
export async function* mapTreeEntries<T>(
  entries: AsyncIterable<TreeEntry>,
  mapper: (entry: TreeEntry) => T,
): AsyncIterable<T> {
  for await (const entry of entries) {
    yield mapper(entry);
  }
}
