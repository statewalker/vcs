/**
 * Mock WorkingTreeIterator for testing
 */

import { vi } from "vitest";

import type {
  WorkingTreeEntry,
  WorkingTreeIterator,
} from "../../src/worktree/working-tree-iterator.js";

/**
 * Create a working tree entry for tests.
 */
export function createWorkingTreeEntry(
  path: string,
  options: Partial<WorkingTreeEntry> = {},
): WorkingTreeEntry {
  return {
    path,
    name: path.split("/").pop() ?? path,
    isDirectory: options.isDirectory ?? false,
    isSymbolicLink: options.isSymbolicLink ?? false,
    isIgnored: options.isIgnored ?? false,
    size: options.size ?? 100,
    mtime: options.mtime ?? Date.now(),
    mode: options.mode ?? 0o100644,
    ...options,
  };
}

/**
 * Create a mock WorkingTreeIterator for testing.
 *
 * @param entries Working tree entries
 * @param hashes Map of path -> object hash
 */
export function createMockWorktree(
  entries: WorkingTreeEntry[] = [],
  hashes: Map<string, string> = new Map(),
): WorkingTreeIterator {
  return {
    walk: vi.fn().mockImplementation(async function* () {
      for (const entry of entries) {
        yield entry;
      }
    }),
    getEntry: vi.fn().mockImplementation(async (path: string) => {
      return entries.find((e) => e.path === path);
    }),
    computeHash: vi.fn().mockImplementation(async (path: string) => {
      return hashes.get(path) ?? "unknown-hash";
    }),
    readContent: vi.fn().mockImplementation(function* () {
      yield new Uint8Array([]);
    }),
  } as unknown as WorkingTreeIterator;
}
