import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlobStore } from "../../src/blob/blob-store.js";
import type { CommitStore } from "../../src/commits/commit-store.js";
import { FileMode } from "../../src/files/index.js";
import type { HistoryStore } from "../../src/history-store.js";
import type { RefStore } from "../../src/refs/ref-store.js";
import type { StagingEntry, StagingStore } from "../../src/staging/staging-store.js";
import { FileStatus } from "../../src/status/status-calculator.js";
import type { TreeEntry, TreeStore } from "../../src/trees/tree-store.js";
import { MemoryStashStore } from "../../src/working-copy/stash-store.memory.js";
import {
  GitWorkingCopy,
  type WorkingCopyFilesApi,
} from "../../src/working-copy/working-copy.files.js";
import type {
  WorkingTreeEntry,
  WorkingTreeIterator,
} from "../../src/worktree/working-tree-iterator.js";

/**
 * Create mock files API
 */
function createMockFilesApi(): WorkingCopyFilesApi {
  return {
    readFile: vi.fn().mockResolvedValue(undefined),
    fileExists: vi.fn().mockResolvedValue(false),
    readDir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkingCopyFilesApi;
}

/**
 * Create mock tree store
 */
function createMockTreeStore(entries: Map<string, TreeEntry[]>): TreeStore {
  return {
    loadTree: vi.fn().mockImplementation(async function* (treeId: string) {
      const treeEntries = entries.get(treeId) ?? [];
      for (const entry of treeEntries) {
        yield entry;
      }
    }),
    storeTree: vi.fn(),
    getEntry: vi.fn().mockImplementation(async (treeId: string, name: string) => {
      const treeEntries = entries.get(treeId) ?? [];
      return treeEntries.find((e) => e.name === name);
    }),
    hasTree: vi.fn(),
    getEmptyTreeId: vi.fn().mockReturnValue("4b825dc642cb6eb9a060e54bf8d69288fbee4904"),
  } as unknown as TreeStore;
}

/**
 * Create mock staging store
 */
function createMockStagingStore(
  stagingEntries: StagingEntry[] = [],
  conflictPaths: string[] = [],
): StagingStore {
  return {
    listEntries: vi.fn().mockImplementation(async function* () {
      for (const entry of stagingEntries) {
        yield entry;
      }
    }),
    getEntry: vi.fn().mockImplementation(async (path: string) => {
      return stagingEntries.find((e) => e.path === path && e.stage === 0);
    }),
    getEntryByStage: vi.fn(),
    getEntries: vi.fn(),
    hasEntry: vi.fn(),
    getEntryCount: vi.fn(),
    listEntriesUnder: vi.fn(),
    hasConflicts: vi.fn().mockResolvedValue(conflictPaths.length > 0),
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
    isOutdated: vi.fn(),
    getUpdateTime: vi.fn().mockReturnValue(Date.now() - 10000),
  } as unknown as StagingStore;
}

/**
 * Create mock working tree iterator
 */
function createMockWorktree(
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
    readContent: vi.fn(),
  } as unknown as WorkingTreeIterator;
}

/**
 * Create mock commit store
 */
function createMockCommitStore(trees: Map<string, string> = new Map()): CommitStore {
  return {
    storeCommit: vi.fn(),
    loadCommit: vi.fn(),
    getParents: vi.fn(),
    getTree: vi.fn().mockImplementation(async (commitId: string) => {
      return trees.get(commitId);
    }),
    walkAncestry: vi.fn(),
    findMergeBase: vi.fn(),
    hasCommit: vi.fn(),
    isAncestor: vi.fn(),
  } as unknown as CommitStore;
}

/**
 * Create mock ref store
 */
function createMockRefStore(headCommit?: string, branch?: string): RefStore {
  return {
    get: vi.fn().mockImplementation(async (name: string) => {
      if (name === "HEAD" && branch) {
        return { target: `refs/heads/${branch}` };
      }
      return undefined;
    }),
    resolve: vi.fn().mockImplementation(async () => {
      if (headCommit) {
        return { objectId: headCommit };
      }
      return undefined;
    }),
    set: vi.fn(),
    setSymbolic: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    exists: vi.fn(),
  } as unknown as RefStore;
}

/**
 * Create mock blob store
 */
function createMockBlobStore(): BlobStore {
  return {
    storeBlob: vi.fn(),
    loadBlob: vi.fn(),
    hasBlob: vi.fn(),
  } as unknown as BlobStore;
}

/**
 * Create mock repository
 */
function createMockRepository(options: {
  headCommit?: string;
  branch?: string;
  treeEntries?: Map<string, TreeEntry[]>;
  commitTrees?: Map<string, string>;
}): HistoryStore {
  const { headCommit, branch = "main", treeEntries = new Map(), commitTrees = new Map() } = options;

  return {
    refs: createMockRefStore(headCommit, branch),
    trees: createMockTreeStore(treeEntries),
    commits: createMockCommitStore(commitTrees),
    blobs: createMockBlobStore(),
    tags: {} as unknown,
    objects: {} as unknown,
    config: {},
    close: vi.fn(),
    isInitialized: vi.fn().mockResolvedValue(true),
    initialize: vi.fn(),
  } as unknown as Repository;
}

/**
 * Create staging entry helper
 */
function createStagingEntry(
  path: string,
  objectId: string,
  options: Partial<StagingEntry> = {},
): StagingEntry {
  return {
    path,
    objectId,
    mode: FileMode.REGULAR_FILE,
    stage: 0,
    size: 100,
    mtime: Date.now() - 10000,
    ...options,
  };
}

/**
 * Create working tree entry helper
 */
function createWorkingTreeEntry(
  path: string,
  options: Partial<WorkingTreeEntry> = {},
): WorkingTreeEntry {
  return {
    path,
    name: path.split("/").pop() ?? path,
    mode: FileMode.REGULAR_FILE,
    size: 100,
    mtime: Date.now() - 10000,
    isDirectory: false,
    isIgnored: false,
    ...options,
  };
}

describe("GitWorkingCopy", () => {
  let workingCopy: GitWorkingCopy;
  let mockRepository: HistoryStore;
  let mockWorktree: WorkingTreeIterator;
  let mockStaging: StagingStore;
  let mockStash: MemoryStashStore;
  let mockFiles: WorkingCopyFilesApi;

  beforeEach(() => {
    mockRepository = createMockRepository({
      headCommit: "abc123",
      branch: "main",
    });
    mockWorktree = createMockWorktree();
    mockStaging = createMockStagingStore();
    mockStash = new MemoryStashStore();
    mockFiles = createMockFilesApi();

    workingCopy = new GitWorkingCopy(
      mockRepository,
      mockWorktree,
      mockStaging,
      mockStash,
      {},
      mockFiles,
      "/repo/.git",
    );
  });

  describe("getHead", () => {
    it("should return commit ID from refs", async () => {
      const head = await workingCopy.getHead();
      expect(head).toBe("abc123");
    });

    it("should return undefined when no HEAD", async () => {
      mockRepository = createMockRepository({});
      workingCopy = new GitWorkingCopy(
        mockRepository,
        mockWorktree,
        mockStaging,
        mockStash,
        {},
        mockFiles,
        "/repo/.git",
      );

      const head = await workingCopy.getHead();
      expect(head).toBeUndefined();
    });
  });

  describe("getCurrentBranch", () => {
    it("should return branch name", async () => {
      const branch = await workingCopy.getCurrentBranch();
      expect(branch).toBe("main");
    });

    it("should return undefined when detached HEAD", async () => {
      vi.mocked(mockRepository.refs.get).mockResolvedValue({ objectId: "abc123" });

      const branch = await workingCopy.getCurrentBranch();
      expect(branch).toBeUndefined();
    });
  });

  describe("getStatus - StatusCalculator integration", () => {
    it("should return clean status for empty repository", async () => {
      const status = await workingCopy.getStatus();

      expect(status.files).toEqual([]);
      expect(status.isClean).toBe(true);
      expect(status.hasStaged).toBe(false);
      expect(status.hasUnstaged).toBe(false);
      expect(status.hasUntracked).toBe(false);
      expect(status.branch).toBe("main");
    });

    it("should detect added file in staging", async () => {
      // Set up repository with head commit and tree
      const treeEntries = new Map<string, TreeEntry[]>();
      treeEntries.set("head-tree", []);

      const commitTrees = new Map<string, string>();
      commitTrees.set("head-commit", "head-tree");

      mockRepository = createMockRepository({
        headCommit: "head-commit",
        branch: "main",
        treeEntries,
        commitTrees,
      });

      // Add file to staging
      const stagingEntries = [createStagingEntry("new-file.txt", "new-hash")];
      mockStaging = createMockStagingStore(stagingEntries);

      // Add file to worktree
      const worktreeEntries = [createWorkingTreeEntry("new-file.txt")];
      const worktreeHashes = new Map([["new-file.txt", "new-hash"]]);
      mockWorktree = createMockWorktree(worktreeEntries, worktreeHashes);

      workingCopy = new GitWorkingCopy(
        mockRepository,
        mockWorktree,
        mockStaging,
        mockStash,
        {},
        mockFiles,
        "/repo/.git",
      );

      const status = await workingCopy.getStatus();

      expect(status.hasStaged).toBe(true);
      expect(
        status.files.some((f) => f.path === "new-file.txt" && f.indexStatus === FileStatus.ADDED),
      ).toBe(true);
    });

    it("should detect untracked files", async () => {
      // Add untracked file to worktree
      const worktreeEntries = [createWorkingTreeEntry("untracked.txt")];
      mockWorktree = createMockWorktree(worktreeEntries);

      workingCopy = new GitWorkingCopy(
        mockRepository,
        mockWorktree,
        mockStaging,
        mockStash,
        {},
        mockFiles,
        "/repo/.git",
      );

      const status = await workingCopy.getStatus();

      expect(status.hasUntracked).toBe(true);
      expect(
        status.files.some(
          (f) => f.path === "untracked.txt" && f.workTreeStatus === FileStatus.UNTRACKED,
        ),
      ).toBe(true);
    });

    it("should detect conflicts", async () => {
      mockStaging = createMockStagingStore([], ["conflict.txt"]);

      const worktreeEntries = [createWorkingTreeEntry("conflict.txt")];
      mockWorktree = createMockWorktree(worktreeEntries);

      workingCopy = new GitWorkingCopy(
        mockRepository,
        mockWorktree,
        mockStaging,
        mockStash,
        {},
        mockFiles,
        "/repo/.git",
      );

      const status = await workingCopy.getStatus();

      expect(status.hasConflicts).toBe(true);
    });

    it("should respect status options like includeUntracked", async () => {
      const worktreeEntries = [createWorkingTreeEntry("untracked.txt")];
      mockWorktree = createMockWorktree(worktreeEntries);

      workingCopy = new GitWorkingCopy(
        mockRepository,
        mockWorktree,
        mockStaging,
        mockStash,
        {},
        mockFiles,
        "/repo/.git",
      );

      const status = await workingCopy.getStatus({ includeUntracked: false });

      expect(status.files.some((f) => f.path === "untracked.txt")).toBe(false);
    });
  });

  describe("setHead", () => {
    it("should set HEAD to branch", async () => {
      await workingCopy.setHead("feature");

      expect(mockRepository.refs.setSymbolic).toHaveBeenCalledWith("HEAD", "refs/heads/feature");
    });

    it("should set HEAD to full ref path", async () => {
      await workingCopy.setHead("refs/heads/develop");

      expect(mockRepository.refs.setSymbolic).toHaveBeenCalledWith("HEAD", "refs/heads/develop");
    });

    it("should set detached HEAD for commit ID", async () => {
      const commitId = "abcdef1234567890abcdef1234567890abcdef12";
      await workingCopy.setHead(commitId);

      expect(mockRepository.refs.set).toHaveBeenCalledWith("HEAD", commitId);
    });
  });

  describe("isDetachedHead", () => {
    it("should return false when on branch", async () => {
      expect(await workingCopy.isDetachedHead()).toBe(false);
    });

    it("should return true when detached", async () => {
      vi.mocked(mockRepository.refs.get).mockResolvedValue({ objectId: "abc123" });

      expect(await workingCopy.isDetachedHead()).toBe(true);
    });
  });
});
