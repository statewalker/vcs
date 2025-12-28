import { describe, expect, it, vi } from "vitest";
import { readCherryPickState } from "../../src/working-copy/cherry-pick-state-reader.js";
import { getStateCapabilities, RepositoryState } from "../../src/working-copy/repository-state.js";
import { detectRepositoryState } from "../../src/working-copy/repository-state-detector.js";
import { readRevertState } from "../../src/working-copy/revert-state-reader.js";

describe("RepositoryState", () => {
  describe("enum values", () => {
    it("should define BARE state", () => {
      expect(RepositoryState.BARE).toBe("bare");
    });

    it("should define SAFE state", () => {
      expect(RepositoryState.SAFE).toBe("safe");
    });

    it("should define MERGING states", () => {
      expect(RepositoryState.MERGING).toBe("merging");
      expect(RepositoryState.MERGING_RESOLVED).toBe("merging-resolved");
    });

    it("should define CHERRY_PICKING states", () => {
      expect(RepositoryState.CHERRY_PICKING).toBe("cherry-picking");
      expect(RepositoryState.CHERRY_PICKING_RESOLVED).toBe("cherry-picking-resolved");
    });

    it("should define REVERTING states", () => {
      expect(RepositoryState.REVERTING).toBe("reverting");
      expect(RepositoryState.REVERTING_RESOLVED).toBe("reverting-resolved");
    });

    it("should define REBASING states", () => {
      expect(RepositoryState.REBASING).toBe("rebasing");
      expect(RepositoryState.REBASING_MERGE).toBe("rebasing-merge");
      expect(RepositoryState.REBASING_INTERACTIVE).toBe("rebasing-interactive");
    });

    it("should define APPLY state", () => {
      expect(RepositoryState.APPLY).toBe("apply");
    });

    it("should define BISECTING state", () => {
      expect(RepositoryState.BISECTING).toBe("bisecting");
    });
  });
});

describe("getStateCapabilities", () => {
  describe("SAFE state", () => {
    it("should allow all operations", () => {
      const caps = getStateCapabilities(RepositoryState.SAFE);

      expect(caps.canCheckout).toBe(true);
      expect(caps.canCommit).toBe(true);
      expect(caps.canResetHead).toBe(true);
      expect(caps.canAmend).toBe(true);
      expect(caps.isRebasing).toBe(false);
    });
  });

  describe("BARE state", () => {
    it("should deny all operations", () => {
      const caps = getStateCapabilities(RepositoryState.BARE);

      expect(caps.canCheckout).toBe(false);
      expect(caps.canCommit).toBe(false);
      expect(caps.canResetHead).toBe(false);
      expect(caps.canAmend).toBe(false);
      expect(caps.isRebasing).toBe(false);
    });
  });

  describe("MERGING state", () => {
    it("should deny checkout and commit, allow reset", () => {
      const caps = getStateCapabilities(RepositoryState.MERGING);

      expect(caps.canCheckout).toBe(false);
      expect(caps.canCommit).toBe(false);
      expect(caps.canResetHead).toBe(true);
      expect(caps.canAmend).toBe(false);
    });
  });

  describe("MERGING_RESOLVED state", () => {
    it("should allow commit, deny checkout", () => {
      const caps = getStateCapabilities(RepositoryState.MERGING_RESOLVED);

      expect(caps.canCheckout).toBe(false);
      expect(caps.canCommit).toBe(true);
      expect(caps.canResetHead).toBe(true);
    });
  });

  describe("CHERRY_PICKING state", () => {
    it("should deny checkout and commit", () => {
      const caps = getStateCapabilities(RepositoryState.CHERRY_PICKING);

      expect(caps.canCheckout).toBe(false);
      expect(caps.canCommit).toBe(false);
      expect(caps.canResetHead).toBe(true);
    });
  });

  describe("CHERRY_PICKING_RESOLVED state", () => {
    it("should allow commit", () => {
      const caps = getStateCapabilities(RepositoryState.CHERRY_PICKING_RESOLVED);

      expect(caps.canCheckout).toBe(false);
      expect(caps.canCommit).toBe(true);
    });
  });

  describe("REVERTING state", () => {
    it("should deny checkout and commit", () => {
      const caps = getStateCapabilities(RepositoryState.REVERTING);

      expect(caps.canCheckout).toBe(false);
      expect(caps.canCommit).toBe(false);
      expect(caps.canResetHead).toBe(true);
    });
  });

  describe("REVERTING_RESOLVED state", () => {
    it("should allow commit", () => {
      const caps = getStateCapabilities(RepositoryState.REVERTING_RESOLVED);

      expect(caps.canCheckout).toBe(false);
      expect(caps.canCommit).toBe(true);
    });
  });

  describe("REBASING states", () => {
    it("should indicate rebasing, deny checkout and commit, allow amend", () => {
      for (const state of [
        RepositoryState.REBASING,
        RepositoryState.REBASING_MERGE,
        RepositoryState.REBASING_INTERACTIVE,
      ]) {
        const caps = getStateCapabilities(state);

        expect(caps.isRebasing).toBe(true);
        expect(caps.canCheckout).toBe(false);
        expect(caps.canCommit).toBe(false);
        expect(caps.canAmend).toBe(true);
      }
    });
  });

  describe("APPLY state", () => {
    it("should deny checkout and commit, allow amend", () => {
      const caps = getStateCapabilities(RepositoryState.APPLY);

      expect(caps.canCheckout).toBe(false);
      expect(caps.canCommit).toBe(false);
      expect(caps.canAmend).toBe(true);
      expect(caps.isRebasing).toBe(false);
    });
  });

  describe("BISECTING state", () => {
    it("should allow checkout only", () => {
      const caps = getStateCapabilities(RepositoryState.BISECTING);

      expect(caps.canCheckout).toBe(true);
      expect(caps.canCommit).toBe(false);
      expect(caps.canResetHead).toBe(false);
      expect(caps.canAmend).toBe(false);
    });
  });
});

describe("detectRepositoryState", () => {
  function createMockFiles(files: Record<string, boolean>) {
    return {
      read: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockImplementation((path: string) => {
        return Promise.resolve(files[path] ?? false);
      }),
    };
  }

  describe("SAFE state", () => {
    it("should return SAFE when no state files exist", async () => {
      const files = createMockFiles({});

      const state = await detectRepositoryState(files, ".git", false);

      expect(state).toBe(RepositoryState.SAFE);
    });
  });

  describe("rebase states", () => {
    it("should detect REBASING_INTERACTIVE", async () => {
      const files = createMockFiles({
        ".git/rebase-merge": true,
        ".git/rebase-merge/interactive": true,
      });

      const state = await detectRepositoryState(files, ".git", false);

      expect(state).toBe(RepositoryState.REBASING_INTERACTIVE);
    });

    it("should detect REBASING_MERGE", async () => {
      const files = createMockFiles({
        ".git/rebase-merge": true,
      });

      const state = await detectRepositoryState(files, ".git", false);

      expect(state).toBe(RepositoryState.REBASING_MERGE);
    });

    it("should detect APPLY", async () => {
      const files = createMockFiles({
        ".git/rebase-apply": true,
        ".git/rebase-apply/applying": true,
      });

      const state = await detectRepositoryState(files, ".git", false);

      expect(state).toBe(RepositoryState.APPLY);
    });

    it("should detect REBASING from rebase-apply", async () => {
      const files = createMockFiles({
        ".git/rebase-apply": true,
      });

      const state = await detectRepositoryState(files, ".git", false);

      expect(state).toBe(RepositoryState.REBASING);
    });
  });

  describe("merge states", () => {
    it("should detect MERGING with conflicts", async () => {
      const files = createMockFiles({
        ".git/MERGE_HEAD": true,
      });

      const state = await detectRepositoryState(files, ".git", true);

      expect(state).toBe(RepositoryState.MERGING);
    });

    it("should detect MERGING_RESOLVED without conflicts", async () => {
      const files = createMockFiles({
        ".git/MERGE_HEAD": true,
      });

      const state = await detectRepositoryState(files, ".git", false);

      expect(state).toBe(RepositoryState.MERGING_RESOLVED);
    });
  });

  describe("cherry-pick states", () => {
    it("should detect CHERRY_PICKING with conflicts", async () => {
      const files = createMockFiles({
        ".git/CHERRY_PICK_HEAD": true,
      });

      const state = await detectRepositoryState(files, ".git", true);

      expect(state).toBe(RepositoryState.CHERRY_PICKING);
    });

    it("should detect CHERRY_PICKING_RESOLVED without conflicts", async () => {
      const files = createMockFiles({
        ".git/CHERRY_PICK_HEAD": true,
      });

      const state = await detectRepositoryState(files, ".git", false);

      expect(state).toBe(RepositoryState.CHERRY_PICKING_RESOLVED);
    });
  });

  describe("revert states", () => {
    it("should detect REVERTING with conflicts", async () => {
      const files = createMockFiles({
        ".git/REVERT_HEAD": true,
      });

      const state = await detectRepositoryState(files, ".git", true);

      expect(state).toBe(RepositoryState.REVERTING);
    });

    it("should detect REVERTING_RESOLVED without conflicts", async () => {
      const files = createMockFiles({
        ".git/REVERT_HEAD": true,
      });

      const state = await detectRepositoryState(files, ".git", false);

      expect(state).toBe(RepositoryState.REVERTING_RESOLVED);
    });
  });

  describe("bisect state", () => {
    it("should detect BISECTING", async () => {
      const files = createMockFiles({
        ".git/BISECT_LOG": true,
      });

      const state = await detectRepositoryState(files, ".git", false);

      expect(state).toBe(RepositoryState.BISECTING);
    });
  });

  describe("priority", () => {
    it("should prioritize rebase over merge", async () => {
      const files = createMockFiles({
        ".git/rebase-merge": true,
        ".git/MERGE_HEAD": true,
      });

      const state = await detectRepositoryState(files, ".git", true);

      expect(state).toBe(RepositoryState.REBASING_MERGE);
    });

    it("should prioritize merge over cherry-pick", async () => {
      const files = createMockFiles({
        ".git/MERGE_HEAD": true,
        ".git/CHERRY_PICK_HEAD": true,
      });

      const state = await detectRepositoryState(files, ".git", true);

      expect(state).toBe(RepositoryState.MERGING);
    });
  });
});

describe("readCherryPickState", () => {
  function createMockFiles(content: Record<string, string | undefined>) {
    return {
      read: vi.fn().mockImplementation((path: string) => {
        const value = content[path];
        if (value === undefined) return Promise.resolve(undefined);
        return Promise.resolve(new TextEncoder().encode(value));
      }),
    };
  }

  it("should return undefined when CHERRY_PICK_HEAD does not exist", async () => {
    const files = createMockFiles({});

    const state = await readCherryPickState(files, ".git");

    expect(state).toBeUndefined();
  });

  it("should return cherry-pick state when CHERRY_PICK_HEAD exists", async () => {
    const files = createMockFiles({
      ".git/CHERRY_PICK_HEAD": "abc123def456\n",
    });

    const state = await readCherryPickState(files, ".git");

    expect(state).toEqual({
      cherryPickHead: "abc123def456",
      message: undefined,
    });
  });

  it("should include message from MERGE_MSG", async () => {
    const files = createMockFiles({
      ".git/CHERRY_PICK_HEAD": "abc123def456\n",
      ".git/MERGE_MSG": "Cherry-pick commit message\n",
    });

    const state = await readCherryPickState(files, ".git");

    expect(state).toEqual({
      cherryPickHead: "abc123def456",
      message: "Cherry-pick commit message\n",
    });
  });
});

describe("readRevertState", () => {
  function createMockFiles(content: Record<string, string | undefined>) {
    return {
      read: vi.fn().mockImplementation((path: string) => {
        const value = content[path];
        if (value === undefined) return Promise.resolve(undefined);
        return Promise.resolve(new TextEncoder().encode(value));
      }),
    };
  }

  it("should return undefined when REVERT_HEAD does not exist", async () => {
    const files = createMockFiles({});

    const state = await readRevertState(files, ".git");

    expect(state).toBeUndefined();
  });

  it("should return revert state when REVERT_HEAD exists", async () => {
    const files = createMockFiles({
      ".git/REVERT_HEAD": "abc123def456\n",
    });

    const state = await readRevertState(files, ".git");

    expect(state).toEqual({
      revertHead: "abc123def456",
      message: undefined,
    });
  });

  it("should include message from MERGE_MSG", async () => {
    const files = createMockFiles({
      ".git/REVERT_HEAD": "abc123def456\n",
      ".git/MERGE_MSG": "Revert commit message\n",
    });

    const state = await readRevertState(files, ".git");

    expect(state).toEqual({
      revertHead: "abc123def456",
      message: "Revert commit message\n",
    });
  });
});
