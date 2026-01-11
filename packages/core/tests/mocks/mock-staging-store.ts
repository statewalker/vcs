/**
 * Mock StagingStore for testing
 */

import { vi } from "vitest";

import {
  MergeStage,
  type MergeStageValue,
  type StagingEntry,
  type StagingStore,
} from "../../src/workspace/staging/staging-store.js";

/**
 * Create a staging entry for tests.
 */
export function createStagingEntry(
  path: string,
  objectId: string,
  stage: MergeStageValue = MergeStage.MERGED,
  options: Partial<StagingEntry> = {},
): StagingEntry {
  return {
    path,
    objectId,
    mode: options.mode ?? 0o100644,
    stage,
    size: options.size ?? 100,
    mtime: options.mtime ?? Date.now(),
    ctime: options.ctime ?? Date.now(),
    dev: options.dev ?? 0,
    ino: options.ino ?? 0,
    uid: options.uid ?? 0,
    gid: options.gid ?? 0,
    flags: options.flags ?? 0,
    assumeValid: options.assumeValid ?? false,
    ...options,
  };
}

/**
 * Create a mock StagingStore for testing.
 *
 * @param entries Stage 0 entries to include
 * @param conflictPaths Paths that have conflicts
 */
export function createMockStagingStore(
  entries: StagingEntry[] = [],
  conflictPaths: string[] = [],
): StagingStore {
  return {
    listEntries: vi.fn().mockImplementation(async function* () {
      for (const entry of entries) {
        yield entry;
      }
    }),
    getEntry: vi.fn().mockImplementation(async (path: string) => {
      return entries.find((e) => e.path === path && e.stage === 0);
    }),
    getEntryByStage: vi.fn().mockImplementation(async (path: string, stage: number) => {
      return entries.find((e) => e.path === path && e.stage === stage);
    }),
    getEntries: vi.fn().mockImplementation(async (path: string) => {
      return entries.filter((e) => e.path === path);
    }),
    hasEntry: vi.fn().mockImplementation(async (path: string) => {
      return entries.some((e) => e.path === path);
    }),
    getEntryCount: vi.fn().mockReturnValue(entries.length),
    listEntriesUnder: vi.fn().mockImplementation(async function* (prefix: string) {
      for (const entry of entries) {
        if (entry.path.startsWith(prefix)) {
          yield entry;
        }
      }
    }),
    hasConflicts: vi.fn().mockReturnValue(conflictPaths.length > 0),
    getConflictPaths: vi.fn().mockImplementation(async function* () {
      for (const path of conflictPaths) {
        yield path;
      }
    }),
    builder: vi.fn(),
    editor: vi.fn(),
    clear: vi.fn(),
    writeTree: vi.fn(),
    readTree: vi.fn(),
    read: vi.fn(),
    write: vi.fn(),
    isOutdated: vi.fn().mockReturnValue(false),
    getUpdateTime: vi.fn().mockReturnValue(Date.now()),
  } as unknown as StagingStore;
}
