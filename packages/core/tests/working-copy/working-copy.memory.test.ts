import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "../../src/repository.js";
import type { StagingStore } from "../../src/staging/staging-store.js";
import { MemoryStashStore } from "../../src/working-copy/stash-store.memory.js";
import { MemoryWorkingCopy } from "../../src/working-copy/working-copy.memory.js";
import type { MergeState, RebaseState } from "../../src/working-copy.js";
import type { WorkingTreeIterator } from "../../src/worktree/working-tree-iterator.js";

describe("MemoryWorkingCopy", () => {
  let workingCopy: MemoryWorkingCopy;
  let mockRepository: Repository;
  let mockWorktree: WorkingTreeIterator;
  let mockStaging: StagingStore;

  beforeEach(() => {
    // Create mock repository
    mockRepository = {
      refs: {
        resolve: vi.fn().mockResolvedValue({ objectId: "abc123" }),
        get: vi.fn().mockResolvedValue({ target: "refs/heads/main" }),
        set: vi.fn().mockResolvedValue(undefined),
        setSymbolic: vi.fn().mockResolvedValue(undefined),
      },
      blobs: {},
      trees: {},
      commits: {},
      tags: {},
      config: {},
      close: vi.fn(),
      isInitialized: vi.fn().mockResolvedValue(true),
    } as unknown as Repository;

    mockWorktree = {} as WorkingTreeIterator;

    mockStaging = {
      read: vi.fn().mockResolvedValue(undefined),
      hasConflicts: vi.fn().mockResolvedValue(false),
    } as unknown as StagingStore;

    workingCopy = new MemoryWorkingCopy(mockRepository, mockWorktree, mockStaging);
  });

  describe("constructor", () => {
    it("should create with default stash and config", () => {
      expect(workingCopy.stash).toBeInstanceOf(MemoryStashStore);
      expect(workingCopy.config).toBeDefined();
    });

    it("should accept custom stash", () => {
      const customStash = new MemoryStashStore();
      const wc = new MemoryWorkingCopy(mockRepository, mockWorktree, mockStaging, customStash);
      expect(wc.stash).toBe(customStash);
    });

    it("should accept custom config", () => {
      const customConfig = { "core.autocrlf": true };
      const wc = new MemoryWorkingCopy(
        mockRepository,
        mockWorktree,
        mockStaging,
        undefined,
        customConfig,
      );
      expect(wc.config).toBe(customConfig);
    });
  });

  describe("getHead", () => {
    it("should return commit ID when set locally", async () => {
      workingCopy.setHeadCommit("def456");

      const head = await workingCopy.getHead();
      expect(head).toBe("def456");
    });

    it("should resolve from repository refs when not set locally", async () => {
      const head = await workingCopy.getHead();
      expect(head).toBe("abc123");
    });
  });

  describe("getCurrentBranch", () => {
    it("should return branch name when on branch", async () => {
      workingCopy.setHeadRef("refs/heads/feature");

      const branch = await workingCopy.getCurrentBranch();
      expect(branch).toBe("feature");
    });

    it("should return undefined when detached", async () => {
      workingCopy.setHeadCommit("abc123");

      const branch = await workingCopy.getCurrentBranch();
      expect(branch).toBeUndefined();
    });

    it("should handle non-heads refs", async () => {
      workingCopy.setHeadRef("refs/tags/v1.0");

      const branch = await workingCopy.getCurrentBranch();
      expect(branch).toBeUndefined();
    });
  });

  describe("setHead", () => {
    it("should set HEAD to branch", async () => {
      await workingCopy.setHead("main");

      const branch = await workingCopy.getCurrentBranch();
      expect(branch).toBe("main");
    });

    it("should set HEAD to full ref", async () => {
      await workingCopy.setHead("refs/heads/develop");

      const branch = await workingCopy.getCurrentBranch();
      expect(branch).toBe("develop");
    });

    it("should set detached HEAD for commit ID", async () => {
      await workingCopy.setHead("abcdef1234567890abcdef1234567890abcdef12");

      expect(await workingCopy.isDetachedHead()).toBe(true);
    });
  });

  describe("isDetachedHead", () => {
    it("should return false when on branch", async () => {
      expect(await workingCopy.isDetachedHead()).toBe(false);
    });

    it("should return true when detached", async () => {
      workingCopy.setHeadCommit("abc123");

      expect(await workingCopy.isDetachedHead()).toBe(true);
    });
  });

  describe("merge state", () => {
    it("should return undefined when no merge in progress", async () => {
      const state = await workingCopy.getMergeState();
      expect(state).toBeUndefined();
    });

    it("should return merge state when set", async () => {
      const mergeState: MergeState = {
        mergeHead: "abc123",
        origHead: "def456",
        message: "Merge branch 'feature'",
      };
      workingCopy.setMergeState(mergeState);

      const state = await workingCopy.getMergeState();
      expect(state).toEqual(mergeState);
    });
  });

  describe("rebase state", () => {
    it("should return undefined when no rebase in progress", async () => {
      const state = await workingCopy.getRebaseState();
      expect(state).toBeUndefined();
    });

    it("should return rebase state when set", async () => {
      const rebaseState: RebaseState = {
        type: "rebase-merge",
        onto: "abc123",
        head: "def456",
        current: 2,
        total: 5,
      };
      workingCopy.setRebaseState(rebaseState);

      const state = await workingCopy.getRebaseState();
      expect(state).toEqual(rebaseState);
    });
  });

  describe("hasOperationInProgress", () => {
    it("should return false when clean", async () => {
      expect(await workingCopy.hasOperationInProgress()).toBe(false);
    });

    it("should return true during merge", async () => {
      workingCopy.setMergeState({
        mergeHead: "abc123",
        origHead: "def456",
      });

      expect(await workingCopy.hasOperationInProgress()).toBe(true);
    });

    it("should return true during rebase", async () => {
      workingCopy.setRebaseState({
        type: "rebase-merge",
        onto: "abc123",
        head: "def456",
        current: 1,
        total: 3,
      });

      expect(await workingCopy.hasOperationInProgress()).toBe(true);
    });
  });

  describe("getStatus", () => {
    it("should return basic status", async () => {
      const status = await workingCopy.getStatus();

      expect(status).toBeDefined();
      expect(status.files).toEqual([]);
      expect(status.isClean).toBe(true);
    });

    it("should detect conflicts from staging", async () => {
      vi.mocked(mockStaging.hasConflicts).mockResolvedValue(true);

      const status = await workingCopy.getStatus();

      expect(status.hasConflicts).toBe(true);
    });
  });

  describe("refresh", () => {
    it("should call staging.read", async () => {
      await workingCopy.refresh();

      expect(mockStaging.read).toHaveBeenCalled();
    });
  });

  describe("close", () => {
    it("should complete without error", async () => {
      await expect(workingCopy.close()).resolves.not.toThrow();
    });
  });
});
