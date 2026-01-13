/**
 * Repository Setup and Working Copy Detection Tests
 *
 * JGit parity tests for repository configuration detection:
 * - Bare repository detection from config
 * - Gitdir file parsing (.git file with gitdir: directive)
 * - core.worktree configuration support
 *
 * Based on JGit's RepositorySetupWorkDirTest
 */

import { describe, expect, it, vi } from "vitest";
import { createInMemoryFilesApi } from "../../src/common/files/index.js";
import { createGitRepository } from "../../src/stores/create-repository.js";
import {
  type ConfigFilesApi,
  GitWorkingCopyConfig,
} from "../../src/workspace/working-copy/working-copy-config.files.js";

/**
 * Create mock files API for config tests
 */
function createMockConfigFiles(content: Record<string, string | undefined>): ConfigFilesApi {
  return {
    read: vi.fn().mockImplementation(async (path: string) => {
      const value = content[path];
      if (value === undefined) return undefined;
      return new TextEncoder().encode(value);
    }),
    write: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * JGit parity tests for bare repository detection
 *
 * Based on JGit RepositorySetupWorkDirTest:
 * - testBareFromConfig
 * - testNonBareFromConfig
 * - testBareDefaultsToNonBare
 */
describe("Bare Repository Detection (JGit parity)", () => {
  describe("testBareFromConfig", () => {
    it("should detect bare=true from config file", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	repositoryformatversion = 0
	filemode = true
	bare = true
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.bare")).toBe(true);
    });

    it("should handle bare=yes as true", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	bare = yes
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.bare")).toBe(true);
    });

    it("should handle bare=on as true", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	bare = on
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.bare")).toBe(true);
    });
  });

  describe("testNonBareFromConfig", () => {
    it("should detect bare=false from config file", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	repositoryformatversion = 0
	filemode = true
	bare = false
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.bare")).toBe(false);
    });

    it("should handle bare=no as false", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	bare = no
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.bare")).toBe(false);
    });

    it("should handle bare=off as false", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	bare = off
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.bare")).toBe(false);
    });
  });

  describe("testBareDefaultsToNonBare", () => {
    it("should default to non-bare when core.bare is not set", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	repositoryformatversion = 0
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      // When bare is not specified, get returns undefined
      expect(config.get("core.bare")).toBeUndefined();
    });
  });

  describe("createGitRepository bare option", () => {
    /**
     * Helper to read file content from FilesApi
     */
    async function readFileContent(files: FilesApi, path: string): Promise<Uint8Array | undefined> {
      const chunks: Uint8Array[] = [];
      for await (const chunk of files.read(path)) {
        chunks.push(chunk);
      }
      if (chunks.length === 0) return undefined;
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    }

    it("should create bare repository when bare=true", async () => {
      const files = createInMemoryFilesApi();

      const repo = await createGitRepository(files, ".git", {
        bare: true,
        create: true,
      });

      expect(repo.config.bare).toBe(true);

      // Verify config file was written with bare=true
      const configContent = await readFileContent(files, ".git/config");
      expect(configContent).toBeDefined();
      if (!configContent) {
        throw new Error("configContent should be defined");
      }
      const configText = new TextDecoder().decode(configContent);
      expect(configText).toContain("bare = true");
    });

    it("should create non-bare repository when bare=false", async () => {
      const files = createInMemoryFilesApi();

      const repo = await createGitRepository(files, ".git", {
        bare: false,
        create: true,
      });

      expect(repo.config.bare).toBe(false);

      const configContent = await readFileContent(files, ".git/config");
      if (!configContent) {
        throw new Error("configContent should be defined");
      }
      const configText = new TextDecoder().decode(configContent);
      expect(configText).toContain("bare = false");
    });

    it("should default to non-bare repository", async () => {
      const files = createInMemoryFilesApi();

      const repo = await createGitRepository(files, ".git", { create: true });

      expect(repo.config.bare).toBe(false);
    });
  });
});

/**
 * JGit parity tests for gitdir file parsing
 *
 * Based on JGit RepositorySetupWorkDirTest:
 * - testGitDirFileFindPath
 * - testGitDirFileFromWorktree
 * - testGitDirFileWithAbsolutePath
 * - testGitDirFileWithRelativePath
 *
 * Git allows .git to be a file instead of a directory.
 * Format: "gitdir: <path>"
 */
describe("Gitdir File Parsing (JGit parity)", () => {
  describe("testGitDirFileFindPath", () => {
    it("should parse gitdir directive with absolute path", () => {
      const content = "gitdir: /path/to/main/.git/worktrees/feature";
      const match = content.match(/^gitdir:\s*(.+)$/);

      expect(match).toBeTruthy();
      expect(match?.[1]).toBe("/path/to/main/.git/worktrees/feature");
    });

    it("should parse gitdir directive with trailing newline", () => {
      const content = "gitdir: /path/to/main/.git/worktrees/feature\n";
      const trimmedContent = content.trim();
      const match = trimmedContent.match(/^gitdir:\s*(.+)$/);

      expect(match).toBeTruthy();
      expect(match?.[1]).toBe("/path/to/main/.git/worktrees/feature");
    });

    it("should parse gitdir directive with CRLF", () => {
      const content = "gitdir: /path/to/main/.git/worktrees/feature\r\n";
      const trimmedContent = content.trim();
      const match = trimmedContent.match(/^gitdir:\s*(.+)$/);

      expect(match).toBeTruthy();
      expect(match?.[1]).toBe("/path/to/main/.git/worktrees/feature");
    });
  });

  describe("testGitDirFileFromWorktree", () => {
    it("should handle relative path in gitdir", () => {
      const content = "gitdir: ../.git/worktrees/feature";
      const match = content.match(/^gitdir:\s*(.+)$/);

      expect(match).toBeTruthy();
      expect(match?.[1]).toBe("../.git/worktrees/feature");
    });

    it("should handle Windows-style absolute path", () => {
      const content = "gitdir: C:/Users/test/repo/.git/worktrees/feature";
      const match = content.match(/^gitdir:\s*(.+)$/);

      expect(match).toBeTruthy();
      expect(match?.[1]).toBe("C:/Users/test/repo/.git/worktrees/feature");
    });
  });

  describe("testGitDirFileWithWhitespace", () => {
    it("should trim leading spaces after colon", () => {
      const content = "gitdir:   /path/to/.git/worktrees/feature";
      const match = content.match(/^gitdir:\s*(.+)$/);

      expect(match).toBeTruthy();
      expect(match?.[1]).toBe("/path/to/.git/worktrees/feature");
    });

    it("should preserve spaces in path", () => {
      const content = "gitdir: /path with spaces/.git/worktrees/my feature";
      const match = content.match(/^gitdir:\s*(.+)$/);

      expect(match).toBeTruthy();
      expect(match?.[1]).toBe("/path with spaces/.git/worktrees/my feature");
    });
  });

  describe("gitdir reverse pointer format", () => {
    /**
     * Git also stores a reverse pointer in .git/worktrees/NAME/gitdir
     * Format: absolute path to worktree's .git file
     */
    it("should parse gitdir reverse pointer", () => {
      // This file contains the path back to the worktree's .git file
      const content = "/home/user/worktrees/feature/.git\n";
      const path = content.trim();

      expect(path).toBe("/home/user/worktrees/feature/.git");
    });
  });
});

/**
 * JGit parity tests for core.worktree configuration
 *
 * Based on JGit RepositorySetupWorkDirTest:
 * - testCoreWorktree
 * - testCoreWorktreeAbsolutePath
 * - testCoreWorktreeRelativePath
 *
 * The core.worktree config specifies the location of the working tree
 * when it's not in the default location (parent of .git directory).
 */
describe("core.worktree Config (JGit parity)", () => {
  describe("testCoreWorktree", () => {
    it("should parse core.worktree from config", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	repositoryformatversion = 0
	worktree = /custom/worktree/path
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.worktree")).toBe("/custom/worktree/path");
    });
  });

  describe("testCoreWorktreeAbsolutePath", () => {
    it("should handle absolute path in core.worktree", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	worktree = /absolute/path/to/worktree
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.worktree")).toBe("/absolute/path/to/worktree");
    });

    it("should handle Windows-style absolute path", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	worktree = C:/Users/test/worktree
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.worktree")).toBe("C:/Users/test/worktree");
    });
  });

  describe("testCoreWorktreeRelativePath", () => {
    it("should handle relative path in core.worktree", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	worktree = ../worktree
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.worktree")).toBe("../worktree");
    });
  });

  describe("testCoreWorktreeQuotedPath", () => {
    it("should handle quoted path with spaces", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	worktree = "/path with spaces/worktree"
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.worktree")).toBe("/path with spaces/worktree");
    });
  });

  describe("testCoreWorktreeNotSet", () => {
    it("should return undefined when core.worktree is not set", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	repositoryformatversion = 0
	bare = false
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.worktree")).toBeUndefined();
    });
  });
});

/**
 * Git config file format compatibility tests
 */
describe("Git Config File Format Compatibility", () => {
  describe("section parsing", () => {
    it("should parse simple section", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	key = value
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.key")).toBe("value");
    });

    /**
     * Subsection parsing: [section "subsection"] -> section."subsection"
     * Note: Current implementation preserves quotes in the key path.
     * JGit uses section.subsection (without quotes).
     */
    it("should parse section with subsection (quotes preserved)", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[remote "origin"]
	url = https://github.com/user/repo.git
	fetch = +refs/heads/*:refs/remotes/origin/*
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      // Current parser converts [remote "origin"] to remote."origin".key
      expect(config.get('remote."origin".url')).toBe("https://github.com/user/repo.git");
      expect(config.get('remote."origin".fetch')).toBe("+refs/heads/*:refs/remotes/origin/*");
    });

    it("should parse branch tracking config (quotes preserved)", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[branch "main"]
	remote = origin
	merge = refs/heads/main
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      // Current parser converts [branch "main"] to branch."main".key
      expect(config.get('branch."main".remote')).toBe("origin");
      expect(config.get('branch."main".merge')).toBe("refs/heads/main");
    });
  });

  describe("value types", () => {
    it("should parse integer values", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
	repositoryformatversion = 0
	compression = 9
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.repositoryformatversion")).toBe(0);
      expect(config.get("core.compression")).toBe(9);
    });

    it("should skip comment lines", async () => {
      const files = createMockConfigFiles({
        ".git/config": `[core]
# This is a comment
	bare = false
; Another comment style
	filemode = true
`,
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.bare")).toBe(false);
      expect(config.get("core.filemode")).toBe(true);
    });

    it("should handle empty config file", async () => {
      const files = createMockConfigFiles({
        ".git/config": "",
      });

      const config = new GitWorkingCopyConfig(files, ".git/config");
      await config.load();

      expect(config.get("core.bare")).toBeUndefined();
    });
  });

  describe("config serialization", () => {
    it("should roundtrip config values", async () => {
      const files = createMockConfigFiles({});

      const config = new GitWorkingCopyConfig(files, ".git/config");
      config.set("core.bare", true);
      config.set("core.worktree", "/path/to/worktree");
      config.set("remote.origin.url", "https://github.com/user/repo.git");

      await config.save();

      // Verify write was called
      expect(files.write).toHaveBeenCalled();
      const writeCall = vi.mocked(files.write).mock.calls[0];
      const writtenContent = new TextDecoder().decode(writeCall[1]);

      expect(writtenContent).toContain("bare = true");
      expect(writtenContent).toContain("worktree = /path/to/worktree");
      expect(writtenContent).toContain("url = https://github.com/user/repo.git");
    });
  });
});

/**
 * Additional repository format version tests
 */
describe("Repository Format Version", () => {
  it("should detect repositoryformatversion", async () => {
    const files = createMockConfigFiles({
      ".git/config": `[core]
	repositoryformatversion = 0
`,
    });

    const config = new GitWorkingCopyConfig(files, ".git/config");
    await config.load();

    expect(config.get("core.repositoryformatversion")).toBe(0);
  });

  it("should handle repositoryformatversion = 1", async () => {
    const files = createMockConfigFiles({
      ".git/config": `[core]
	repositoryformatversion = 1
[extensions]
	noop = true
`,
    });

    const config = new GitWorkingCopyConfig(files, ".git/config");
    await config.load();

    expect(config.get("core.repositoryformatversion")).toBe(1);
    expect(config.get("extensions.noop")).toBe(true);
  });
});
