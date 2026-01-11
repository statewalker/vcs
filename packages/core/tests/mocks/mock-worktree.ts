/**
 * Mock WorktreeStore for testing
 */

import { vi } from "vitest";

import type { WorktreeEntry, WorktreeStore } from "../../src/workspace/worktree/worktree-store.js";

/**
 * Create a working tree entry for tests.
 */
export function createWorktreeEntry(
  path: string,
  options: Partial<WorktreeEntry> = {},
): WorktreeEntry {
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
 * Create a mock WorktreeStore for testing.
 *
 * @param entries Working tree entries
 * @param hashes Map of path -> object hash
 */
export function createMockWorktree(
  entries: WorktreeEntry[] = [],
  hashes: Map<string, string> = new Map(),
): WorktreeStore {
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
  } as unknown as WorktreeStore;
}
