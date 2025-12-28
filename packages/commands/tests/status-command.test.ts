/**
 * Tests for StatusCommand
 *
 * Based on JGit's StatusCommandTest.java patterns,
 * adapted for staged-only version without working tree.
 * Tests run against all storage backends (Memory, SQL).
 */

import { afterEach, describe, expect, it } from "vitest";

import { addFile, backends, createInitializedGitFromFactory, removeFile } from "./test-helper.js";

describe.each(backends)("StatusCommand ($name backend)", ({ factory }) => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  async function createInitializedGit() {
    const result = await createInitializedGitFromFactory(factory);
    cleanup = result.cleanup;
    return result;
  }

  describe("empty repository", () => {
    /**
     * Test status on empty repository with no commits.
     *
     * Based on JGit's testEmptyStatus.
     */
    it("should return clean status for empty repository", async () => {
      const { git } = await createInitializedGit();

      const status = await git.status().call();

      expect(status.added.size).toBe(0);
      expect(status.changed.size).toBe(0);
      expect(status.removed.size).toBe(0);
      expect(status.conflicting.size).toBe(0);
      expect(status.isClean()).toBe(true);
      expect(status.hasUncommittedChanges()).toBe(false);
    });

    /**
     * Test status after adding files but before first commit.
     */
    it("should show staged files as added before first commit", async () => {
      const { git, store } = await createInitializedGit();

      // Add files to staging
      await addFile(store, "a.txt", "content of a");
      await addFile(store, "b.txt", "content of b");

      const status = await git.status().call();

      expect(status.added.size).toBe(2);
      expect(status.added.has("a.txt")).toBe(true);
      expect(status.added.has("b.txt")).toBe(true);
      expect(status.changed.size).toBe(0);
      expect(status.removed.size).toBe(0);
      expect(status.isClean()).toBe(false);
      expect(status.hasUncommittedChanges()).toBe(true);
    });
  });

  describe("after initial commit", () => {
    /**
     * Test status is clean after commit.
     */
    it("should be clean after commit", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "a.txt", "content");
      await git.commit().setMessage("initial").call();

      const status = await git.status().call();

      expect(status.isClean()).toBe(true);
      expect(status.hasUncommittedChanges()).toBe(false);
    });

    /**
     * Test status shows added files.
     */
    it("should detect added files", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "a.txt", "content of a");
      await git.commit().setMessage("initial").call();

      // Add new file
      await addFile(store, "b.txt", "content of b");

      const status = await git.status().call();

      expect(status.added.size).toBe(1);
      expect(status.added.has("b.txt")).toBe(true);
      expect(status.changed.size).toBe(0);
      expect(status.removed.size).toBe(0);
      expect(status.hasUncommittedChanges()).toBe(true);
    });

    /**
     * Test status shows changed files.
     */
    it("should detect changed files", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "a.txt", "original content");
      await git.commit().setMessage("initial").call();

      // Modify file
      await addFile(store, "a.txt", "modified content");

      const status = await git.status().call();

      expect(status.added.size).toBe(0);
      expect(status.changed.size).toBe(1);
      expect(status.changed.has("a.txt")).toBe(true);
      expect(status.removed.size).toBe(0);
      expect(status.hasUncommittedChanges()).toBe(true);
    });

    /**
     * Test status shows removed files.
     */
    it("should detect removed files", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "a.txt", "content of a");
      await addFile(store, "b.txt", "content of b");
      await git.commit().setMessage("initial").call();

      // Remove file from staging
      await removeFile(store, "b.txt");

      const status = await git.status().call();

      expect(status.added.size).toBe(0);
      expect(status.changed.size).toBe(0);
      expect(status.removed.size).toBe(1);
      expect(status.removed.has("b.txt")).toBe(true);
      expect(status.hasUncommittedChanges()).toBe(true);
    });

    /**
     * Test status with multiple changes.
     *
     * Based on JGit's testDifferentStates.
     */
    it("should show multiple change types", async () => {
      const { git, store } = await createInitializedGit();

      // Initial commit
      await addFile(store, "existing.txt", "existing content");
      await addFile(store, "to-modify.txt", "original");
      await addFile(store, "to-delete.txt", "delete me");
      await git.commit().setMessage("initial").call();

      // Make various changes
      await addFile(store, "new-file.txt", "new content"); // added
      await addFile(store, "to-modify.txt", "modified"); // changed
      await removeFile(store, "to-delete.txt"); // removed

      const status = await git.status().call();

      expect(status.added.size).toBe(1);
      expect(status.added.has("new-file.txt")).toBe(true);
      expect(status.changed.size).toBe(1);
      expect(status.changed.has("to-modify.txt")).toBe(true);
      expect(status.removed.size).toBe(1);
      expect(status.removed.has("to-delete.txt")).toBe(true);
      expect(status.isClean()).toBe(false);
    });
  });

  describe("path filtering", () => {
    /**
     * Test filtering by exact file path.
     *
     * Based on JGit's testDifferentStatesWithPaths.
     */
    it("should filter by exact file path", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "a.txt", "a");
      await addFile(store, "b.txt", "b");
      await git.commit().setMessage("initial").call();

      // Modify both
      await addFile(store, "a.txt", "modified a");
      await addFile(store, "b.txt", "modified b");

      // Filter to only "a.txt"
      const status = await git.status().addPath("a.txt").call();

      expect(status.changed.size).toBe(1);
      expect(status.changed.has("a.txt")).toBe(true);
      expect(status.changed.has("b.txt")).toBe(false);
    });

    /**
     * Test filtering by directory prefix.
     */
    it("should filter by directory prefix", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "root.txt", "root");
      await addFile(store, "src/a.txt", "a");
      await addFile(store, "src/b.txt", "b");
      await addFile(store, "docs/readme.txt", "readme");
      await git.commit().setMessage("initial").call();

      // Modify all
      await addFile(store, "root.txt", "modified root");
      await addFile(store, "src/a.txt", "modified a");
      await addFile(store, "src/b.txt", "modified b");
      await addFile(store, "docs/readme.txt", "modified readme");

      // Filter to only "src" directory
      const status = await git.status().addPath("src").call();

      expect(status.changed.size).toBe(2);
      expect(status.changed.has("src/a.txt")).toBe(true);
      expect(status.changed.has("src/b.txt")).toBe(true);
      expect(status.changed.has("root.txt")).toBe(false);
      expect(status.changed.has("docs/readme.txt")).toBe(false);
    });

    /**
     * Test filtering with multiple paths.
     */
    it("should filter by multiple paths", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "a.txt", "a");
      await addFile(store, "src/b.txt", "b");
      await addFile(store, "docs/c.txt", "c");
      await git.commit().setMessage("initial").call();

      // Modify all
      await addFile(store, "a.txt", "modified a");
      await addFile(store, "src/b.txt", "modified b");
      await addFile(store, "docs/c.txt", "modified c");

      // Filter to "a.txt" and "docs"
      const status = await git.status().addPath("a.txt").addPath("docs").call();

      expect(status.changed.size).toBe(2);
      expect(status.changed.has("a.txt")).toBe(true);
      expect(status.changed.has("docs/c.txt")).toBe(true);
      expect(status.changed.has("src/b.txt")).toBe(false);
    });

    /**
     * Test filter on non-existing path returns empty result.
     */
    it("should return empty status for non-existing path", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "a.txt", "a");
      await git.commit().setMessage("initial").call();

      await addFile(store, "a.txt", "modified");

      // Filter to non-existing path
      const status = await git.status().addPath("nonexistent").call();

      expect(status.changed.size).toBe(0);
      expect(status.isClean()).toBe(true);
    });
  });

  describe("conflicts", () => {
    /**
     * Test status detects conflicts after merge.
     */
    it("should detect conflicting files", async () => {
      const { git, store } = await createInitializedGit();

      // Create base
      await addFile(store, "file.txt", "base content");
      await git.commit().setMessage("base").call();
      const baseCommit = await store.refs.resolve("HEAD");

      // Create branch
      await git
        .branchCreate()
        .setName("side")
        .setStartPoint(baseCommit?.objectId ?? "")
        .call();

      // Modify on main
      await addFile(store, "file.txt", "main content");
      await git.commit().setMessage("main").call();
      const mainHead = await store.refs.resolve("HEAD");

      // Checkout side and modify
      await store.refs.setSymbolic("HEAD", "refs/heads/side");
      const baseCommitData = await store.commits.loadCommit(baseCommit?.objectId ?? "");
      await store.staging.readTree(store.trees, baseCommitData.tree);
      await addFile(store, "file.txt", "side content");
      await git.commit().setMessage("side").call();

      // Merge - should conflict
      const mergeResult = await git
        .merge()
        .include(mainHead?.objectId ?? "")
        .call();
      expect(mergeResult.conflicts).toContain("file.txt");

      // Check status shows conflict
      const status = await git.status().call();

      expect(status.conflicting.size).toBe(1);
      expect(status.conflicting.has("file.txt")).toBe(true);
      expect(status.isClean()).toBe(false);
      expect(status.hasUncommittedChanges()).toBe(true);
    });

    /**
     * Test status after resolving conflicts.
     */
    it("should be clean after resolving conflicts", async () => {
      const { git, store } = await createInitializedGit();

      // Create conflict scenario
      await addFile(store, "file.txt", "base");
      await git.commit().setMessage("base").call();
      const baseCommit = await store.refs.resolve("HEAD");

      await git
        .branchCreate()
        .setName("side")
        .setStartPoint(baseCommit?.objectId ?? "")
        .call();

      await addFile(store, "file.txt", "main");
      await git.commit().setMessage("main").call();
      const mainHead = await store.refs.resolve("HEAD");

      await store.refs.setSymbolic("HEAD", "refs/heads/side");
      const baseCommitData = await store.commits.loadCommit(baseCommit?.objectId ?? "");
      await store.staging.readTree(store.trees, baseCommitData.tree);
      await addFile(store, "file.txt", "side");
      await git.commit().setMessage("side").call();

      // Create merge conflict
      await git
        .merge()
        .include(mainHead?.objectId ?? "")
        .call();

      // Verify conflict exists
      let status = await git.status().call();
      expect(status.conflicting.has("file.txt")).toBe(true);

      // Resolve conflict by rebuilding staging with only the resolved entry
      // (Using builder which replaces all entries, removing conflict stages)
      const encoder = new TextEncoder();
      const resolvedContent = encoder.encode("resolved");
      const resolvedId = await store.blobs.store([resolvedContent]);

      const builder = store.staging.builder();
      builder.add({
        path: "file.txt",
        mode: 0o100644,
        objectId: resolvedId,
        stage: 0,
        size: resolvedContent.length,
        mtime: Date.now(),
      });
      await builder.finish();

      status = await git.status().call();

      // After resolution, no more conflicts, just a changed file staged
      expect(status.conflicting.size).toBe(0);
      expect(status.changed.size).toBe(1);
      expect(status.changed.has("file.txt")).toBe(true);
    });
  });

  describe("nested paths", () => {
    /**
     * JGit: testDifferentStatesWithPaths - nested directory filtering
     * Tests filtering on nested paths like D/D/d
     */
    it("should filter on deeply nested paths", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "a.txt", "a");
      await addFile(store, "D/b.txt", "b");
      await addFile(store, "D/c.txt", "c");
      await addFile(store, "D/D/d.txt", "d");
      await git.commit().setMessage("initial").call();

      // Modify all
      await addFile(store, "a.txt", "new a");
      await addFile(store, "D/b.txt", "new b");
      await addFile(store, "D/D/d.txt", "new d");

      // Filter on D/D only
      const status = await git.status().addPath("D/D").call();

      expect(status.changed.size).toBe(1);
      expect(status.changed.has("D/D/d.txt")).toBe(true);
      expect(status.changed.has("a.txt")).toBe(false);
      expect(status.changed.has("D/b.txt")).toBe(false);
    });

    /**
     * JGit: testDifferentStatesWithPaths - combined nested + root filtering
     */
    it("should combine nested and root path filters", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "a.txt", "a");
      await addFile(store, "D/b.txt", "b");
      await addFile(store, "D/D/d.txt", "d");
      await git.commit().setMessage("initial").call();

      // Modify all
      await addFile(store, "a.txt", "new a");
      await addFile(store, "D/b.txt", "new b");
      await addFile(store, "D/D/d.txt", "new d");

      // Filter on D/D and a.txt
      const status = await git.status().addPath("D/D").addPath("a.txt").call();

      expect(status.changed.size).toBe(2);
      expect(status.changed.has("a.txt")).toBe(true);
      expect(status.changed.has("D/D/d.txt")).toBe(true);
      expect(status.changed.has("D/b.txt")).toBe(false);
    });
  });

  describe("convenience methods", () => {
    /**
     * Test isClean() method.
     */
    it("isClean should return true only when no changes", async () => {
      const { git, store } = await createInitializedGit();

      // Initially clean
      let status = await git.status().call();
      expect(status.isClean()).toBe(true);

      // Add file - not clean
      await addFile(store, "a.txt", "content");
      status = await git.status().call();
      expect(status.isClean()).toBe(false);

      // Commit - clean again
      await git.commit().setMessage("initial").call();
      status = await git.status().call();
      expect(status.isClean()).toBe(true);
    });

    /**
     * Test hasUncommittedChanges() method.
     */
    it("hasUncommittedChanges should mirror isClean negation", async () => {
      const { git, store } = await createInitializedGit();

      let status = await git.status().call();
      expect(status.hasUncommittedChanges()).toBe(false);

      await addFile(store, "a.txt", "content");
      status = await git.status().call();
      expect(status.hasUncommittedChanges()).toBe(true);

      await git.commit().setMessage("initial").call();
      status = await git.status().call();
      expect(status.hasUncommittedChanges()).toBe(false);
    });
  });
});
