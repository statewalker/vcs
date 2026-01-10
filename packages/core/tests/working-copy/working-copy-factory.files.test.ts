import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryStore } from "../../src/history-store.js";
import type { StagingStore } from "../../src/staging/staging-store.js";
import {
  type GitWorkingCopyContext,
  GitWorkingCopyFactory,
  type WorkingCopyFactoryFilesApi,
} from "../../src/working-copy/working-copy-factory.files.js";
import type { WorkingTreeIterator } from "../../src/worktree/working-tree-iterator.js";

/**
 * Create mock files API
 */
function createMockFilesApi(): WorkingCopyFactoryFilesApi {
  return {
    readFile: vi.fn().mockResolvedValue(undefined),
    fileExists: vi.fn().mockResolvedValue(false),
    readDir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    // From StashFilesApi
    deleteFile: vi.fn(),
    rename: vi.fn(),
    // From ConfigFilesApi
    read: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkingCopyFactoryFilesApi;
}

/**
 * Create mock staging store
 */
function createMockStagingStore(): StagingStore {
  return {
    listEntries: vi.fn().mockImplementation(async function* () {}),
    getEntry: vi.fn(),
    getEntryByStage: vi.fn(),
    getEntries: vi.fn(),
    hasEntry: vi.fn(),
    getEntryCount: vi.fn(),
    listEntriesUnder: vi.fn(),
    hasConflicts: vi.fn().mockResolvedValue(false),
    getConflictPaths: vi.fn().mockImplementation(async function* () {}),
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
function createMockWorktree(): WorkingTreeIterator {
  return {
    walk: vi.fn().mockImplementation(async function* () {}),
    getEntry: vi.fn(),
    computeHash: vi.fn(),
    readContent: vi.fn(),
  } as unknown as WorkingTreeIterator;
}

/**
 * Create mock repository
 */
function createMockRepository(options: { path?: string; headCommit?: string } = {}): HistoryStore {
  const { path, headCommit = "abc123" } = options;

  return {
    refs: {
      get: vi.fn().mockImplementation(async (name: string) => {
        if (name === "HEAD") {
          return { target: "refs/heads/main" };
        }
        if (name === "refs/heads/main") {
          return { objectId: headCommit };
        }
        return undefined;
      }),
      resolve: vi.fn().mockResolvedValue({ objectId: headCommit }),
      set: vi.fn().mockResolvedValue(undefined),
      setSymbolic: vi.fn().mockResolvedValue(undefined),
    },
    trees: {
      loadTree: vi.fn().mockImplementation(async function* () {}),
      getEntry: vi.fn(),
      storeTree: vi.fn(),
      hasTree: vi.fn(),
      getEmptyTreeId: vi.fn().mockReturnValue("4b825dc642cb6eb9a060e54bf8d69288fbee4904"),
    },
    commits: {
      getTree: vi.fn(),
      storeCommit: vi.fn(),
      loadCommit: vi.fn(),
    },
    blobs: {},
    tags: {},
    objects: {},
    config: path ? { path } : {},
    close: vi.fn(),
    isInitialized: vi.fn().mockResolvedValue(true),
    initialize: vi.fn(),
  } as unknown as Repository;
}

describe("GitWorkingCopyFactory", () => {
  let factory: GitWorkingCopyFactory;
  let mockFiles: WorkingCopyFactoryFilesApi;
  let mockCreateContext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFiles = createMockFilesApi();
    mockCreateContext = vi.fn().mockImplementation(async (): Promise<GitWorkingCopyContext> => {
      return {
        repository: createMockRepository({ path: "/repo/.git" }),
        createStagingStore: vi.fn().mockResolvedValue(createMockStagingStore()),
        createWorktreeIterator: vi.fn().mockReturnValue(createMockWorktree()),
      };
    });

    factory = new GitWorkingCopyFactory(mockFiles, mockCreateContext);
  });

  describe("openWorkingCopy", () => {
    it("should create a working copy", async () => {
      const wc = await factory.openWorkingCopy("/worktree", "/repo/.git");

      expect(wc).toBeDefined();
      expect(wc.repository).toBeDefined();
      expect(wc.worktree).toBeDefined();
      expect(wc.staging).toBeDefined();
      expect(wc.stash).toBeDefined();
    });

    it("should pass repository path to createContext", async () => {
      await factory.openWorkingCopy("/worktree", "/repo/.git");

      expect(mockCreateContext).toHaveBeenCalledWith("/repo/.git", {});
    });
  });

  describe("addWorktree", () => {
    it("should throw if repository.config.path is not set", async () => {
      const repository = createMockRepository({});

      await expect(factory.addWorktree(repository, "/new-worktree")).rejects.toThrow(
        "Cannot add worktree: repository.config.path is not set",
      );
    });

    it("should create worktree directories", async () => {
      const repository = createMockRepository({ path: "/repo/.git" });

      await factory.addWorktree(repository, "/new-worktree");

      expect(mockFiles.mkdir).toHaveBeenCalledWith("/new-worktree");
      expect(mockFiles.mkdir).toHaveBeenCalledWith("/repo/.git/worktrees");
      expect(mockFiles.mkdir).toHaveBeenCalledWith("/repo/.git/worktrees/new-worktree");
    });

    it("should create .git file in worktree", async () => {
      const repository = createMockRepository({ path: "/repo/.git" });

      await factory.addWorktree(repository, "/new-worktree");

      expect(mockFiles.writeFile).toHaveBeenCalledWith(
        "/new-worktree/.git",
        "gitdir: /repo/.git/worktrees/new-worktree\n",
      );
    });

    it("should create gitdir file in worktrees/NAME", async () => {
      const repository = createMockRepository({ path: "/repo/.git" });

      await factory.addWorktree(repository, "/new-worktree");

      expect(mockFiles.writeFile).toHaveBeenCalledWith(
        "/repo/.git/worktrees/new-worktree/gitdir",
        "/new-worktree/.git\n",
      );
    });

    it("should set detached HEAD when commit option is provided", async () => {
      const repository = createMockRepository({ path: "/repo/.git" });

      await factory.addWorktree(repository, "/new-worktree", { commit: "def456" });

      expect(mockFiles.writeFile).toHaveBeenCalledWith(
        "/repo/.git/worktrees/new-worktree/HEAD",
        "def456\n",
      );
    });

    it("should set HEAD to branch when branch option is provided", async () => {
      const repository = createMockRepository({ path: "/repo/.git" });
      vi.mocked(repository.refs.get).mockImplementation(async (name: string) => {
        if (name === "refs/heads/feature") {
          return { objectId: "feature-commit" };
        }
        if (name === "HEAD") {
          return { target: "refs/heads/main" };
        }
        return undefined;
      });

      await factory.addWorktree(repository, "/new-worktree", { branch: "feature" });

      expect(mockFiles.writeFile).toHaveBeenCalledWith(
        "/repo/.git/worktrees/new-worktree/HEAD",
        "ref: refs/heads/feature\n",
      );
    });

    it("should throw if branch does not exist and force is false", async () => {
      const repository = createMockRepository({ path: "/repo/.git" });
      vi.mocked(repository.refs.get).mockResolvedValue(undefined);

      await expect(
        factory.addWorktree(repository, "/new-worktree", { branch: "nonexistent" }),
      ).rejects.toThrow("Branch 'nonexistent' does not exist. Use force: true to create it.");
    });

    it("should create branch if it does not exist and force is true", async () => {
      const repository = createMockRepository({ path: "/repo/.git", headCommit: "abc123" });
      vi.mocked(repository.refs.get).mockImplementation(async (name: string) => {
        if (name === "HEAD") {
          return { target: "refs/heads/main" };
        }
        // Return undefined for new-branch to simulate it doesn't exist
        return undefined;
      });

      await factory.addWorktree(repository, "/new-worktree", {
        branch: "new-branch",
        force: true,
      });

      expect(repository.refs.set).toHaveBeenCalledWith("refs/heads/new-branch", "abc123");
    });

    it("should use detached HEAD at current commit when no options provided", async () => {
      const repository = createMockRepository({ path: "/repo/.git", headCommit: "current-head" });

      await factory.addWorktree(repository, "/new-worktree");

      expect(mockFiles.writeFile).toHaveBeenCalledWith(
        "/repo/.git/worktrees/new-worktree/HEAD",
        "current-head\n",
      );
    });

    it("should throw if no commits and no branch/commit specified", async () => {
      const repository = createMockRepository({ path: "/repo/.git" });
      vi.mocked(repository.refs.resolve).mockResolvedValue(undefined);

      await expect(factory.addWorktree(repository, "/new-worktree")).rejects.toThrow(
        "Cannot add worktree: repository has no commits.",
      );
    });

    it("should return a working copy", async () => {
      const repository = createMockRepository({ path: "/repo/.git" });

      const wc = await factory.addWorktree(repository, "/new-worktree");

      expect(wc).toBeDefined();
      expect(wc.repository).toBeDefined();
      expect(wc.worktree).toBeDefined();
      expect(wc.staging).toBeDefined();
    });
  });
});
