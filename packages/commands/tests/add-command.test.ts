/**
 * Tests for AddCommand
 *
 * Based on JGit's AddCommandTest.java patterns.
 * Ports key test cases for staging files from working tree.
 * Tests run against all storage backends (Memory, SQL).
 *
 * Reference: tmp/jgit/org.eclipse.jgit.test/tst/org/eclipse/jgit/api/AddCommandTest.java
 */

import {
  FileMode,
  type WorkingTreeEntry,
  type WorkingTreeIterator,
  type WorkingTreeIteratorOptions,
} from "@statewalker/vcs-core";
import { afterEach, describe, expect, it } from "vitest";

import { NoFilepatternError } from "../src/errors/index.js";
import { Git } from "../src/git.js";
import type { GitStoreWithWorkTree } from "../src/types.js";
import { backends, type GitStoreFactory } from "./test-helper.js";

/**
 * Mock working tree for testing AddCommand.
 *
 * Simulates a filesystem with in-memory files.
 */
class MockWorkingTree implements WorkingTreeIterator {
  private files: Map<string, { content: Uint8Array; mode: number; mtime: number }> = new Map();
  private ignored: Set<string> = new Set();

  /** Add a file to the mock working tree */
  addFile(path: string, content: string, mode = FileMode.REGULAR_FILE): void {
    this.files.set(path, {
      content: new TextEncoder().encode(content),
      mode,
      mtime: Date.now(),
    });
  }

  /** Remove a file from the mock working tree */
  removeFile(path: string): void {
    this.files.delete(path);
  }

  /** Mark a file as ignored */
  markIgnored(path: string): void {
    this.ignored.add(path);
  }

  /** Get all file paths */
  getPaths(): string[] {
    return Array.from(this.files.keys()).sort();
  }

  // WorkingTreeIterator implementation

  async *walk(options?: WorkingTreeIteratorOptions): AsyncIterable<WorkingTreeEntry> {
    const paths = Array.from(this.files.keys()).sort();

    for (const path of paths) {
      const file = this.files.get(path);
      if (!file) continue;
      const isIgnored = this.ignored.has(path);

      // Skip ignored files unless requested
      if (isIgnored && !options?.includeIgnored) {
        continue;
      }

      // Apply path prefix filter
      if (options?.pathPrefix && !path.startsWith(options.pathPrefix)) {
        continue;
      }

      yield {
        path,
        name: path.split("/").pop() ?? path,
        mode: file.mode,
        size: file.content.length,
        mtime: file.mtime,
        isDirectory: false,
        isIgnored,
      };
    }
  }

  async getEntry(path: string): Promise<WorkingTreeEntry | undefined> {
    const file = this.files.get(path);
    if (!file) return undefined;

    return {
      path,
      name: path.split("/").pop() ?? path,
      mode: file.mode,
      size: file.content.length,
      mtime: file.mtime,
      isDirectory: false,
      isIgnored: this.ignored.has(path),
    };
  }

  async computeHash(path: string): Promise<string> {
    // For testing purposes, return a simple hash
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    // Simple string hash (not real SHA-1)
    let hash = 0;
    const content = new TextDecoder().decode(file.content);
    for (let i = 0; i < content.length; i++) {
      hash = (hash << 5) - hash + content.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(40, "0");
  }

  async *readContent(path: string): AsyncIterable<Uint8Array> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    yield file.content;
  }
}

/**
 * Create an initialized Git instance with working tree support using a factory.
 */
async function createInitializedGitWithWorkTreeFromFactory(factory: GitStoreFactory): Promise<{
  git: Git;
  store: GitStoreWithWorkTree;
  worktree: MockWorkingTree;
  initialCommitId: string;
  cleanup?: () => Promise<void>;
}> {
  const ctx = await factory();
  const baseStore = ctx.store;
  const worktree = new MockWorkingTree();

  const store: GitStoreWithWorkTree = {
    ...baseStore,
    worktree,
  };

  const git = Git.wrap(store);

  // Create and store empty tree
  const emptyTreeId = await store.trees.storeTree([]);

  // Create initial commit
  const initialCommit = {
    tree: emptyTreeId,
    parents: [],
    author: {
      name: "Test Author",
      email: "test@example.com",
      timestamp: Math.floor(Date.now() / 1000),
      tzOffset: "+0000",
    },
    committer: {
      name: "Test Author",
      email: "test@example.com",
      timestamp: Math.floor(Date.now() / 1000),
      tzOffset: "+0000",
    },
    message: "Initial commit",
  };

  const initialCommitId = await store.commits.storeCommit(initialCommit);

  // Set up refs
  await store.refs.set("refs/heads/main", initialCommitId);
  await store.refs.setSymbolic("HEAD", "refs/heads/main");

  // Initialize staging with empty tree
  await store.staging.readTree(store.trees, emptyTreeId);

  return { git, store, worktree, initialCommitId, cleanup: ctx.cleanup };
}

describe.each(backends)("AddCommand ($name backend)", ({ factory }) => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  async function createInitializedGitWithWorkTree() {
    const result = await createInitializedGitWithWorkTreeFromFactory(factory);
    cleanup = result.cleanup;
    return result;
  }

  async function createEmptyStore() {
    const ctx = await factory();
    cleanup = ctx.cleanup;
    return ctx.store;
  }
  describe("validation", () => {
    /**
     * JGit: testAddNothing
     * Test that calling add() without patterns throws.
     */
    it("testAddNothing - should throw when no file patterns", async () => {
      const { git } = await createInitializedGitWithWorkTree();

      await expect(git.add().call()).rejects.toThrow(NoFilepatternError);
    });
  });

  describe("basic operations", () => {
    /**
     * JGit: testAddNonExistingSingleFile
     * Adding a non-existing file should not fail, just skip it.
     */
    it("testAddNonExistingSingleFile - should handle non-existing file", async () => {
      const { git, store } = await createInitializedGitWithWorkTree();

      const result = await git.add().addFilepattern("nonexistent.txt").call();

      expect(result.added).toHaveLength(0);
      expect(result.totalProcessed).toBe(0);

      // Verify index is still empty
      let count = 0;
      for await (const _ of store.staging.listEntries()) {
        count++;
      }
      expect(count).toBe(0);
    });

    /**
     * JGit: testAddExistingSingleFile
     * Adding an existing file should stage it.
     */
    it("testAddExistingSingleFile - should stage existing file", async () => {
      const { git, store, worktree } = await createInitializedGitWithWorkTree();

      // Create file in working tree
      worktree.addFile("a.txt", "content");

      // Add to staging
      const result = await git.add().addFilepattern("a.txt").call();

      expect(result.added).toContain("a.txt");
      expect(result.totalProcessed).toBe(1);

      // Verify file is in index
      const entry = await store.staging.getEntry("a.txt");
      expect(entry).toBeDefined();
      expect(entry?.path).toBe("a.txt");
    });

    /**
     * JGit: testAddExistingSingleFileInSubDir
     * Adding a file in a subdirectory should work.
     */
    it("testAddExistingSingleFileInSubDir - should stage file in subdirectory", async () => {
      const { git, store, worktree } = await createInitializedGitWithWorkTree();

      worktree.addFile("sub/a.txt", "content");

      const result = await git.add().addFilepattern("sub/a.txt").call();

      expect(result.added).toContain("sub/a.txt");

      const entry = await store.staging.getEntry("sub/a.txt");
      expect(entry).toBeDefined();
    });

    /**
     * JGit: testAddTwoFiles
     * Adding multiple files at once.
     */
    it("testAddTwoFiles - should stage multiple files", async () => {
      const { git, store, worktree } = await createInitializedGitWithWorkTree();

      worktree.addFile("a.txt", "content a");
      worktree.addFile("b.txt", "content b");

      const result = await git.add().addFilepattern("a.txt").addFilepattern("b.txt").call();

      expect(result.added).toHaveLength(2);
      expect(result.added).toContain("a.txt");
      expect(result.added).toContain("b.txt");

      const entryA = await store.staging.getEntry("a.txt");
      const entryB = await store.staging.getEntry("b.txt");
      expect(entryA).toBeDefined();
      expect(entryB).toBeDefined();
    });

    /**
     * JGit: testAddFolder
     * Adding a directory pattern should stage all files in it.
     */
    it("testAddFolder - should stage all files in directory", async () => {
      const { git, worktree } = await createInitializedGitWithWorkTree();

      worktree.addFile("sub/a.txt", "content a");
      worktree.addFile("sub/b.txt", "content b");

      const result = await git.add().addFilepattern("sub").call();

      expect(result.added).toHaveLength(2);
      expect(result.added).toContain("sub/a.txt");
      expect(result.added).toContain("sub/b.txt");
    });

    /**
     * JGit: testAddWholeRepo
     * Adding "." should stage all files.
     */
    it("testAddWholeRepo - should stage all files with dot pattern", async () => {
      const { git, worktree } = await createInitializedGitWithWorkTree();

      worktree.addFile("a.txt", "a");
      worktree.addFile("sub/b.txt", "b");
      worktree.addFile("sub/c.txt", "c");

      const result = await git.add().addFilepattern(".").call();

      expect(result.added).toHaveLength(3);
      expect(result.added).toContain("a.txt");
      expect(result.added).toContain("sub/b.txt");
      expect(result.added).toContain("sub/c.txt");
    });
  });

  describe("file modifications", () => {
    /**
     * JGit: testAddExistingSingleFileTwice
     * Adding a modified file should update the index.
     */
    it("testAddExistingSingleFileTwice - should update index for modified file", async () => {
      const { git, store, worktree } = await createInitializedGitWithWorkTree();

      // First add
      worktree.addFile("a.txt", "content");
      await git.add().addFilepattern("a.txt").call();

      const firstEntry = await store.staging.getEntry("a.txt");
      const firstOid = firstEntry?.objectId;

      // Modify and add again
      worktree.addFile("a.txt", "modified content");
      await git.add().addFilepattern("a.txt").call();

      const secondEntry = await store.staging.getEntry("a.txt");
      const secondOid = secondEntry?.objectId;

      // Object IDs should be different
      expect(firstOid).not.toBe(secondOid);
    });
  });

  describe("update mode (-u flag)", () => {
    /**
     * JGit: testAddWithParameterUpdate
     * Update mode only stages tracked files, not new ones.
     */
    it("testAddWithParameterUpdate - should only update tracked files", async () => {
      const { git, worktree } = await createInitializedGitWithWorkTree();

      // Initial setup: add and commit files
      worktree.addFile("sub/a.txt", "content a");
      worktree.addFile("sub/b.txt", "content b");
      await git.add().addFilepattern("sub").call();
      await git.commit().setMessage("initial").call();

      // Modify tracked file, add new file, and delete tracked file
      worktree.addFile("sub/a.txt", "modified a");
      worktree.addFile("sub/c.txt", "new file c"); // new file
      worktree.removeFile("sub/b.txt"); // deleted file

      // Use update mode
      const result = await git.add().addFilepattern("sub").setUpdate(true).call();

      // Modified file should be staged
      expect(result.added).toContain("sub/a.txt");
      // Deleted file should be removed from index
      expect(result.removed).toContain("sub/b.txt");
      // New file should NOT be added (update mode ignores new files)
      expect(result.added).not.toContain("sub/c.txt");
    });
  });

  describe("--all mode (-A flag)", () => {
    /**
     * JGit: testAddWithoutParameterUpdate
     * Without update mode but with all=true, deletions are staged.
     */
    it("testAddWithoutParameterUpdate - should stage deletions with all mode", async () => {
      const { git, store, worktree } = await createInitializedGitWithWorkTree();

      // Initial setup
      worktree.addFile("sub/a.txt", "content a");
      worktree.addFile("sub/b.txt", "content b");
      await git.add().addFilepattern("sub").call();
      await git.commit().setMessage("initial").call();

      // Make changes
      worktree.addFile("sub/a.txt", "modified a"); // modify
      worktree.addFile("sub/c.txt", "new c"); // add new
      worktree.removeFile("sub/b.txt"); // delete

      // Use setAll(false) - should not stage deletions
      let result = await git.add().addFilepattern("sub").setAll(false).call();

      // Modified and new files staged
      expect(result.added).toContain("sub/a.txt");
      expect(result.added).toContain("sub/c.txt");
      // Deletion should NOT be staged
      expect(result.removed).not.toContain("sub/b.txt");
      // b.txt should still be in index
      let entryB = await store.staging.getEntry("sub/b.txt");
      expect(entryB).toBeDefined();

      // Now use setAll(true) - should stage deletion
      result = await git.add().addFilepattern("sub").setAll(true).call();

      // Deletion should now be staged
      expect(result.removed).toContain("sub/b.txt");
      // b.txt should be removed from index
      entryB = await store.staging.getEntry("sub/b.txt");
      expect(entryB).toBeUndefined();
    });
  });

  describe("ignored files", () => {
    /**
     * JGit: testAddIgnoredFile
     * Ignored files should be skipped unless force is used.
     */
    it("testAddIgnoredFile - should skip ignored files", async () => {
      const { git, store, worktree } = await createInitializedGitWithWorkTree();

      worktree.addFile("sub/a.txt", "content a");
      worktree.addFile("sub/b.txt", "content b");
      worktree.markIgnored("sub/b.txt");

      const result = await git.add().addFilepattern("sub").call();

      // a.txt should be added
      expect(result.added).toContain("sub/a.txt");
      // b.txt should be skipped
      expect(result.skipped).toContain("sub/b.txt");
      expect(result.added).not.toContain("sub/b.txt");

      // Only a.txt in index
      const entryA = await store.staging.getEntry("sub/a.txt");
      const entryB = await store.staging.getEntry("sub/b.txt");
      expect(entryA).toBeDefined();
      expect(entryB).toBeUndefined();
    });

    /**
     * Test force flag adds ignored files.
     */
    it("should add ignored files with force flag", async () => {
      const { git, store, worktree } = await createInitializedGitWithWorkTree();

      worktree.addFile("ignored.txt", "content");
      worktree.markIgnored("ignored.txt");

      // Without force - skipped
      let result = await git.add().addFilepattern("ignored.txt").call();
      expect(result.skipped).toContain("ignored.txt");

      // With force - added
      result = await git.add().addFilepattern("ignored.txt").setForce(true).call();
      expect(result.added).toContain("ignored.txt");

      const entry = await store.staging.getEntry("ignored.txt");
      expect(entry).toBeDefined();
    });
  });

  describe("glob patterns", () => {
    /**
     * Test extension glob pattern like "*.ts"
     */
    it("should support extension glob patterns", async () => {
      const { git, worktree } = await createInitializedGitWithWorkTree();

      worktree.addFile("a.ts", "typescript");
      worktree.addFile("b.ts", "typescript");
      worktree.addFile("c.js", "javascript");

      const result = await git.add().addFilepattern("*.ts").call();

      expect(result.added).toContain("a.ts");
      expect(result.added).toContain("b.ts");
      expect(result.added).not.toContain("c.js");
    });

    /**
     * Test double-star glob pattern like "src/**\/*.ts"
     * Note: src/**\/*.ts requires at least one directory between src/ and filename
     */
    it("should support double-star glob patterns", async () => {
      const { git, worktree } = await createInitializedGitWithWorkTree();

      worktree.addFile("src/a.ts", "a"); // Not matched by src/**/*.ts (no subdir)
      worktree.addFile("src/sub/b.ts", "b");
      worktree.addFile("src/sub/deep/c.ts", "c");
      worktree.addFile("lib/d.ts", "d");

      const result = await git.add().addFilepattern("src/**/*.ts").call();

      // src/a.ts is NOT matched because **/*.ts requires at least one directory
      expect(result.added).not.toContain("src/a.ts");
      expect(result.added).toContain("src/sub/b.ts");
      expect(result.added).toContain("src/sub/deep/c.ts");
      expect(result.added).not.toContain("lib/d.ts");
    });
  });

  describe("intent to add (-N flag)", () => {
    /**
     * Test intent-to-add mode creates placeholder entries.
     */
    it("should create placeholder entries with intent-to-add", async () => {
      const { git, store, worktree } = await createInitializedGitWithWorkTree();

      worktree.addFile("new.txt", "content");

      const result = await git.add().addFilepattern("new.txt").setIntentToAdd(true).call();

      expect(result.added).toContain("new.txt");

      const entry = await store.staging.getEntry("new.txt");
      expect(entry).toBeDefined();
      // Intent-to-add entries have empty object ID and zero size
      expect(entry?.objectId).toBe("");
      expect(entry?.size).toBe(0);
    });
  });

  describe("command state", () => {
    /**
     * Test that command can only be called once.
     */
    it("should throw if called twice", async () => {
      const { git, worktree } = await createInitializedGitWithWorkTree();

      worktree.addFile("a.txt", "content");

      const addCommand = git.add().addFilepattern("a.txt");
      await addCommand.call();

      // Second call should throw
      await expect(addCommand.call()).rejects.toThrow(/already been called/);
    });

    /**
     * Test setter methods throw after call.
     */
    it("should throw if setters called after call", async () => {
      const { git, worktree } = await createInitializedGitWithWorkTree();

      worktree.addFile("a.txt", "content");

      const addCommand = git.add().addFilepattern("a.txt");
      await addCommand.call();

      // Setters should throw after call
      expect(() => addCommand.addFilepattern("b.txt")).toThrow();
      expect(() => addCommand.setUpdate(true)).toThrow();
      expect(() => addCommand.setAll(true)).toThrow();
      expect(() => addCommand.setForce(true)).toThrow();
    });
  });

  describe("getter methods", () => {
    /**
     * Test option getter methods.
     */
    it("should return correct option values", async () => {
      const { git } = await createInitializedGitWithWorkTree();

      const command = git.add();

      // Default values
      expect(command.isUpdate()).toBe(false);
      expect(command.isAll()).toBe(false);
      expect(command.isForce()).toBe(false);
      expect(command.isIntentToAdd()).toBe(false);

      // After setting
      command.setUpdate(true).setForce(true).setIntentToAdd(true);

      expect(command.isUpdate()).toBe(true);
      expect(command.isForce()).toBe(true);
      expect(command.isIntentToAdd()).toBe(true);
    });
  });

  describe("custom working tree iterator", () => {
    /**
     * Test using custom working tree iterator.
     */
    it("should use custom iterator when set", async () => {
      // Create standard store without worktree
      const baseStore = await createEmptyStore();
      const git = Git.wrap(baseStore);

      // Initialize store - store the empty tree first
      const emptyTreeId = await baseStore.trees.storeTree([]);
      const commit = {
        tree: emptyTreeId,
        parents: [],
        author: {
          name: "Test",
          email: "test@example.com",
          timestamp: Math.floor(Date.now() / 1000),
          tzOffset: "+0000",
        },
        committer: {
          name: "Test",
          email: "test@example.com",
          timestamp: Math.floor(Date.now() / 1000),
          tzOffset: "+0000",
        },
        message: "Initial",
      };
      const commitId = await baseStore.commits.storeCommit(commit);
      await baseStore.refs.set("refs/heads/main", commitId);
      await baseStore.refs.setSymbolic("HEAD", "refs/heads/main");
      await baseStore.staging.readTree(baseStore.trees, emptyTreeId);

      // Create custom iterator
      const customWorktree = new MockWorkingTree();
      customWorktree.addFile("custom.txt", "custom content");

      // Without custom iterator, should fail
      await expect(git.add().addFilepattern(".").call()).rejects.toThrow(
        /Working tree iterator not available/,
      );

      // With custom iterator, should work
      const result = await git
        .add()
        .addFilepattern(".")
        .setWorkingTreeIterator(customWorktree)
        .call();

      expect(result.added).toContain("custom.txt");
    });
  });
});
