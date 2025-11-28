import type { TreeEntry } from "../file-tree-storage.js";
/**
 * Collect tree entries from async iterable into array
 *
 * Use when you need all entries in memory (e.g., for manipulation).
 *
 * @param entries AsyncIterable of tree entries
 * @returns Array of tree entries
 */
export declare function collectTreeEntries(entries: AsyncIterable<TreeEntry>): Promise<TreeEntry[]>;
/**
 * Convert array to async iterable
 *
 * Use when you have entries in memory and need to pass to storeTree.
 *
 * @param entries Array of tree entries
 * @returns AsyncIterable of tree entries
 */
export declare function iterateTreeEntries(entries: TreeEntry[]): AsyncIterable<TreeEntry>;
/**
 * Check if mode represents a tree (directory)
 */
export declare function isTreeMode(mode: number): boolean;
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
export declare function compareTreeEntries(a: TreeEntry, b: TreeEntry): number;
/**
 * Sort tree entries in Git canonical order
 *
 * @param entries Array of tree entries
 * @returns New sorted array (does not modify original)
 */
export declare function sortTreeEntries(entries: TreeEntry[]): TreeEntry[];
/**
 * Filter tree entries by predicate
 *
 * @param entries AsyncIterable of tree entries
 * @param predicate Filter function
 * @returns AsyncIterable of filtered entries
 */
export declare function filterTreeEntries(entries: AsyncIterable<TreeEntry>, predicate: (entry: TreeEntry) => boolean): AsyncIterable<TreeEntry>;
/**
 * Map tree entries
 *
 * @param entries AsyncIterable of tree entries
 * @param mapper Transform function
 * @returns AsyncIterable of transformed entries
 */
export declare function mapTreeEntries<T>(entries: AsyncIterable<TreeEntry>, mapper: (entry: TreeEntry) => T): AsyncIterable<T>;
