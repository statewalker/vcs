import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryCheckoutStore,
  MemoryCheckoutStore,
} from "../../src/checkout/checkout-store.memory.js";
import type { RefStore } from "../../src/refs/ref-store.js";
import type { StagingStore } from "../../src/staging/staging-store.js";
import { RepositoryState } from "../../src/working-copy/repository-state.js";
import { MemoryStashStore } from "../../src/working-copy/stash-store.memory.js";
import type {
  CherryPickState,
  MergeState,
  RebaseState,
  RevertState,
} from "../../src/working-copy.js";

describe("MemoryCheckoutStore", () => {
  let checkoutStore: MemoryCheckoutStore;
  let mockRefs: RefStore;
  let mockStaging: StagingStore;

  beforeEach(() => {
    mockRefs = {
      resolve: vi.fn().mockResolvedValue({ objectId: "abc123" }),
      get: vi.fn().mockResolvedValue({ target: "refs/heads/main" }),
      set: vi.fn().mockResolvedValue(undefined),
      setSymbolic: vi.fn().mockResolvedValue(undefined),
    } as unknown as RefStore;

    mockStaging = {
      read: vi.fn().mockResolvedValue(undefined),
      hasConflicts: vi.fn().mockResolvedValue(false),
    } as unknown as StagingStore;

    checkoutStore = new MemoryCheckoutStore(mockStaging, mockRefs);
  });

  describe("constructor", () => {
    it("should create with default stash and config", () => {
      expect(checkoutStore.stash).toBeInstanceOf(MemoryStashStore);
      expect(checkoutStore.config).toBeDefined();
    });

    it("should accept custom stash", () => {
      const customStash = new MemoryStashStore();
      const store = new MemoryCheckoutStore(mockStaging, mockRefs, customStash);
      expect(store.stash).toBe(customStash);
    });

    it("should accept custom config", () => {
      const customConfig = { "core.autocrlf": true };
      const store = new MemoryCheckoutStore(mockStaging, mockRefs, undefined, customConfig);
      expect(store.config).toBe(customConfig);
    });

    it("should work without refs", () => {
      const store = new MemoryCheckoutStore(mockStaging);
      expect(store.staging).toBe(mockStaging);
    });
  });

  describe("getHead", () => {
    it("should return commit ID when set locally", async () => {
      checkoutStore.setHeadCommit("def456");

      const head = await checkoutStore.getHead();
      expect(head).toBe("def456");
    });

    it("should resolve from refs when not set locally", async () => {
      const head = await checkoutStore.getHead();
      expect(head).toBe("abc123");
    });

    it("should return undefined when no refs and not set locally", async () => {
      const store = new MemoryCheckoutStore(mockStaging);
      const head = await store.getHead();
      expect(head).toBeUndefined();
    });
  });

  describe("getCurrentBranch", () => {
    it("should return branch name when on branch", async () => {
      checkoutStore.setHeadRef("refs/heads/feature");

      const branch = await checkoutStore.getCurrentBranch();
      expect(branch).toBe("feature");
    });

    it("should return undefined when detached", async () => {
      checkoutStore.setHeadCommit("abc123");

      const branch = await checkoutStore.getCurrentBranch();
      expect(branch).toBeUndefined();
    });

    it("should handle non-heads refs", async () => {
      checkoutStore.setHeadRef("refs/tags/v1.0");

      const branch = await checkoutStore.getCurrentBranch();
      expect(branch).toBeUndefined();
    });
  });

  describe("setHead", () => {
    it("should set branch reference", async () => {
      await checkoutStore.setHead("feature");

      const branch = await checkoutStore.getCurrentBranch();
      expect(branch).toBe("feature");
    });

    it("should set full ref path", async () => {
      await checkoutStore.setHead("refs/heads/develop");

      const branch = await checkoutStore.getCurrentBranch();
      expect(branch).toBe("develop");
    });

    it("should set detached HEAD for commit ID", async () => {
      const commitId = "abc123def456abc123def456abc123def456abc1";
      await checkoutStore.setHead(commitId);

      expect(await checkoutStore.isDetachedHead()).toBe(true);
    });

    it("should update refs if available", async () => {
      await checkoutStore.setHead("feature");

      expect(mockRefs.setSymbolic).toHaveBeenCalledWith("HEAD", "refs/heads/feature");
    });
  });

  describe("isDetachedHead", () => {
    it("should return false when on branch", async () => {
      checkoutStore.setHeadRef("refs/heads/main");

      expect(await checkoutStore.isDetachedHead()).toBe(false);
    });

    it("should return true when detached", async () => {
      checkoutStore.setHeadCommit("abc123");

      expect(await checkoutStore.isDetachedHead()).toBe(true);
    });
  });

  describe("merge state", () => {
    it("should return undefined when no merge in progress", async () => {
      expect(await checkoutStore.getMergeState()).toBeUndefined();
    });

    it("should return merge state when set", async () => {
      const mergeState: MergeState = {
        mergeHead: "abc123",
        origHead: "def456",
        message: "Merge branch 'feature'",
      };
      checkoutStore.setMergeState(mergeState);

      expect(await checkoutStore.getMergeState()).toEqual(mergeState);
    });

    it("should clear merge state", async () => {
      checkoutStore.setMergeState({
        mergeHead: "abc123",
        origHead: "def456",
      });
      checkoutStore.setMergeState(undefined);

      expect(await checkoutStore.getMergeState()).toBeUndefined();
    });
  });

  describe("rebase state", () => {
    it("should return undefined when no rebase in progress", async () => {
      expect(await checkoutStore.getRebaseState()).toBeUndefined();
    });

    it("should return rebase state when set", async () => {
      const rebaseState: RebaseState = {
        type: "rebase-merge",
        onto: "abc123",
        head: "def456",
        current: 2,
        total: 5,
      };
      checkoutStore.setRebaseState(rebaseState);

      expect(await checkoutStore.getRebaseState()).toEqual(rebaseState);
    });
  });

  describe("cherry-pick state", () => {
    it("should return undefined when no cherry-pick in progress", async () => {
      expect(await checkoutStore.getCherryPickState()).toBeUndefined();
    });

    it("should return cherry-pick state when set", async () => {
      const cherryPickState: CherryPickState = {
        cherryPickHead: "abc123",
        message: "Cherry pick commit",
      };
      checkoutStore.setCherryPickState(cherryPickState);

      expect(await checkoutStore.getCherryPickState()).toEqual(cherryPickState);
    });
  });

  describe("revert state", () => {
    it("should return undefined when no revert in progress", async () => {
      expect(await checkoutStore.getRevertState()).toBeUndefined();
    });

    it("should return revert state when set", async () => {
      const revertState: RevertState = {
        revertHead: "abc123",
        message: "Revert commit",
      };
      checkoutStore.setRevertState(revertState);

      expect(await checkoutStore.getRevertState()).toEqual(revertState);
    });
  });

  describe("hasOperationInProgress", () => {
    it("should return false when no operation in progress", async () => {
      expect(await checkoutStore.hasOperationInProgress()).toBe(false);
    });

    it("should return true when merge in progress", async () => {
      checkoutStore.setMergeState({ mergeHead: "abc", origHead: "def" });
      expect(await checkoutStore.hasOperationInProgress()).toBe(true);
    });

    it("should return true when rebase in progress", async () => {
      checkoutStore.setRebaseState({
        type: "rebase",
        onto: "abc",
        head: "def",
        current: 1,
        total: 3,
      });
      expect(await checkoutStore.hasOperationInProgress()).toBe(true);
    });

    it("should return true when cherry-pick in progress", async () => {
      checkoutStore.setCherryPickState({ cherryPickHead: "abc" });
      expect(await checkoutStore.hasOperationInProgress()).toBe(true);
    });

    it("should return true when revert in progress", async () => {
      checkoutStore.setRevertState({ revertHead: "abc" });
      expect(await checkoutStore.hasOperationInProgress()).toBe(true);
    });
  });

  describe("getState", () => {
    it("should return SAFE by default", async () => {
      expect(await checkoutStore.getState()).toBe(RepositoryState.SAFE);
    });

    it("should return set state", async () => {
      checkoutStore.setRepositoryState(RepositoryState.MERGING);
      expect(await checkoutStore.getState()).toBe(RepositoryState.MERGING);
    });
  });

  describe("getStateCapabilities", () => {
    it("should return capabilities for SAFE state", async () => {
      const caps = await checkoutStore.getStateCapabilities();
      expect(caps.canCheckout).toBe(true);
      expect(caps.canCommit).toBe(true);
      expect(caps.isRebasing).toBe(false);
    });

    it("should return capabilities for MERGING state", async () => {
      checkoutStore.setRepositoryState(RepositoryState.MERGING);
      const caps = await checkoutStore.getStateCapabilities();
      expect(caps.canCheckout).toBe(false);
      expect(caps.canCommit).toBe(false);
    });

    it("should return capabilities for REBASING state", async () => {
      checkoutStore.setRepositoryState(RepositoryState.REBASING);
      const caps = await checkoutStore.getStateCapabilities();
      expect(caps.isRebasing).toBe(true);
    });
  });

  describe("refresh", () => {
    it("should refresh staging", async () => {
      await checkoutStore.refresh();
      expect(mockStaging.read).toHaveBeenCalled();
    });
  });

  describe("close", () => {
    it("should complete without error", async () => {
      await expect(checkoutStore.close()).resolves.toBeUndefined();
    });
  });

  describe("createMemoryCheckoutStore", () => {
    it("should create a MemoryCheckoutStore", () => {
      const store = createMemoryCheckoutStore(mockStaging, mockRefs);
      expect(store).toBeInstanceOf(MemoryCheckoutStore);
    });

    it("should work without optional parameters", () => {
      const store = createMemoryCheckoutStore(mockStaging);
      expect(store).toBeInstanceOf(MemoryCheckoutStore);
    });
  });
});
