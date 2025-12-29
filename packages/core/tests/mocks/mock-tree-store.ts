/**
 * Mock TreeStore for testing
 */

import { vi } from "vitest";

import type { TreeEntry } from "../../src/trees/tree-entry.js";
import type { TreeStore } from "../../src/trees/tree-store.js";

/**
 * Create a mock TreeStore for testing.
 *
 * Accepts either:
 * - A Map<string, TreeEntry[]> mapping tree IDs to their entries
 * - A Record<string, TreeEntry[]> object for convenience
 */
export function createMockTreeStore(
  entries: Map<string, TreeEntry[]> | Record<string, TreeEntry[]> = {},
): TreeStore {
  const entriesMap = entries instanceof Map ? entries : new Map(Object.entries(entries));

  return {
    loadTree: vi.fn().mockImplementation(async function* (treeId: string) {
      const treeEntries = entriesMap.get(treeId) ?? [];
      for (const entry of treeEntries) {
        yield entry;
      }
    }),

    storeTree: vi.fn().mockImplementation(async (entries: TreeEntry[]) => {
      // Generate a simple hash based on entries
      const content = entries.map((e) => `${e.mode}:${e.name}:${e.id}`).join(";");
      return `tree-${content.length}`;
    }),

    getEntry: vi.fn().mockImplementation(async (treeId: string, name: string) => {
      const treeEntries = entriesMap.get(treeId) ?? [];
      return treeEntries.find((e) => e.name === name);
    }),
  } as unknown as TreeStore;
}
