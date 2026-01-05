/**
 * Tests for BlameCommand.
 *
 * Tests line-by-line authorship tracking using diff algorithm.
 */

import { afterEach, describe, expect, it } from "vitest";

import { addFile, backends, createInitializedGitFromFactory } from "./test-helper.js";

describe.each(backends)("BlameCommand ($name backend)", ({ factory }) => {
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

  describe("basic blame", () => {
    it("should blame all lines to initial commit", async () => {
      const { git, store } = await createInitializedGit();

      // Add a file with 3 lines
      await addFile(store, "file.txt", "line 1\nline 2\nline 3\n");
      await git.commit().setMessage("Add file with 3 lines").call();

      const result = await git.blame().setFilePath("file.txt").call();

      expect(result.path).toBe("file.txt");
      expect(result.lineCount).toBe(3);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].lineCount).toBe(3);
    });

    it("should track line additions across commits", async () => {
      const { git, store } = await createInitializedGit();

      // Create first commit with one line
      await addFile(store, "file.txt", "line 1\n");
      await git.commit().setMessage("First commit").call();

      // Get the first commit's ID
      const firstCommitRef = await store.refs.resolve("HEAD");
      const firstCommitId = firstCommitRef?.objectId ?? "";

      // Create second commit adding more lines
      await addFile(store, "file.txt", "line 1\nline 2\nline 3\n");
      await git.commit().setMessage("Add lines 2 and 3").call();

      const result = await git.blame().setFilePath("file.txt").call();

      expect(result.lineCount).toBe(3);

      // Line 1 should be blamed to first commit
      const entry1 = result.getEntry(1);
      expect(entry1?.commitId).toBe(firstCommitId);

      // Lines 2 and 3 should be blamed to second commit
      const entry2 = result.getEntry(2);
      expect(entry2?.commitId).not.toBe(firstCommitId);

      const entry3 = result.getEntry(3);
      expect(entry3?.commitId).not.toBe(firstCommitId);
    });

    it("should handle line modifications", async () => {
      const { git, store } = await createInitializedGit();

      // Create first commit with 3 lines
      await addFile(store, "file.txt", "original line 1\noriginal line 2\noriginal line 3\n");
      await git.commit().setMessage("Initial commit").call();

      const firstCommitRef = await store.refs.resolve("HEAD");
      const firstCommitId = firstCommitRef?.objectId ?? "";

      // Modify line 2
      await addFile(store, "file.txt", "original line 1\nmodified line 2\noriginal line 3\n");
      await git.commit().setMessage("Modify line 2").call();

      const secondCommitRef = await store.refs.resolve("HEAD");
      const secondCommitId = secondCommitRef?.objectId ?? "";

      const result = await git.blame().setFilePath("file.txt").call();

      expect(result.lineCount).toBe(3);

      // Lines 1 and 3 should be blamed to first commit
      expect(result.getEntry(1)?.commitId).toBe(firstCommitId);
      expect(result.getEntry(3)?.commitId).toBe(firstCommitId);

      // Line 2 should be blamed to second commit (modified)
      expect(result.getEntry(2)?.commitId).toBe(secondCommitId);
    });

    it("should handle insertions in the middle", async () => {
      const { git, store } = await createInitializedGit();

      // Create first commit with 2 lines
      await addFile(store, "file.txt", "line 1\nline 3\n");
      await git.commit().setMessage("Initial commit").call();

      const firstCommitRef = await store.refs.resolve("HEAD");
      const firstCommitId = firstCommitRef?.objectId ?? "";

      // Insert line 2 in the middle
      await addFile(store, "file.txt", "line 1\nline 2\nline 3\n");
      await git.commit().setMessage("Insert line 2").call();

      const secondCommitRef = await store.refs.resolve("HEAD");
      const secondCommitId = secondCommitRef?.objectId ?? "";

      const result = await git.blame().setFilePath("file.txt").call();

      expect(result.lineCount).toBe(3);

      // Line 1 should be blamed to first commit
      expect(result.getEntry(1)?.commitId).toBe(firstCommitId);

      // Line 2 should be blamed to second commit (inserted)
      expect(result.getEntry(2)?.commitId).toBe(secondCommitId);

      // Line 3 should be blamed to first commit
      expect(result.getEntry(3)?.commitId).toBe(firstCommitId);
    });

    it("should handle multiple commits with different authors", async () => {
      const { git, store } = await createInitializedGit();

      // Create first commit with author A
      await addFile(store, "file.txt", "author A line\n");
      await git.commit().setMessage("Commit by A").setAuthor("Author A", "a@test.com").call();

      // Create second commit with author B adding a line
      await addFile(store, "file.txt", "author A line\nauthor B line\n");
      await git.commit().setMessage("Commit by B").setAuthor("Author B", "b@test.com").call();

      const result = await git.blame().setFilePath("file.txt").call();

      expect(result.lineCount).toBe(2);

      // Line 1 should be by Author A
      expect(result.getSourceAuthor(1)?.name).toBe("Author A");

      // Line 2 should be by Author B
      expect(result.getSourceAuthor(2)?.name).toBe("Author B");
    });
  });

  describe("edge cases", () => {
    it("should handle empty file", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "empty.txt", "");
      await git.commit().setMessage("Add empty file").call();

      const result = await git.blame().setFilePath("empty.txt").call();

      expect(result.lineCount).toBe(0);
      expect(result.entries).toHaveLength(0);
    });

    it("should throw for non-existent file", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "file.txt", "content");
      await git.commit().setMessage("Initial commit").call();

      await expect(git.blame().setFilePath("nonexistent.txt").call()).rejects.toThrow(
        "File not found",
      );
    });

    it("should throw when file path not set", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "file.txt", "content");
      await git.commit().setMessage("Initial commit").call();

      await expect(git.blame().call()).rejects.toThrow("File path must be set");
    });

    it("should blame at specific commit", async () => {
      const { git, store } = await createInitializedGit();

      // Create first commit
      await addFile(store, "file.txt", "line 1\n");
      await git.commit().setMessage("First commit").call();

      const firstCommitRef = await store.refs.resolve("HEAD");
      const firstCommitId = firstCommitRef?.objectId ?? "";

      // Create second commit
      await addFile(store, "file.txt", "line 1\nline 2\n");
      await git.commit().setMessage("Second commit").call();

      // Blame at first commit (only 1 line)
      const result = await git.blame().setFilePath("file.txt").setStartCommit(firstCommitId).call();

      expect(result.lineCount).toBe(1);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].commitId).toBe(firstCommitId);
    });

    it("should handle file with no trailing newline", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "file.txt", "line 1\nline 2"); // No trailing newline
      await git.commit().setMessage("Add file").call();

      const result = await git.blame().setFilePath("file.txt").call();

      expect(result.lineCount).toBe(2);
    });
  });

  describe("BlameResult methods", () => {
    it("getEntry should return correct entry for line", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "file.txt", "line 1\nline 2\nline 3\n");
      await git.commit().setMessage("Initial").call();

      const result = await git.blame().setFilePath("file.txt").call();

      expect(result.getEntry(1)).toBeDefined();
      expect(result.getEntry(2)).toBeDefined();
      expect(result.getEntry(3)).toBeDefined();
      expect(result.getEntry(0)).toBeUndefined(); // 0 is out of range (1-based)
      expect(result.getEntry(4)).toBeUndefined(); // Out of range
    });

    it("getSourceCommit should return commit for line", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "file.txt", "line 1\n");
      await git.commit().setMessage("Initial").call();

      const result = await git.blame().setFilePath("file.txt").call();

      const commit = result.getSourceCommit(1);
      expect(commit).toBeDefined();
      expect(commit?.message).toContain("Initial");
    });

    it("getSourceAuthor should return author for line", async () => {
      const { git, store } = await createInitializedGit();

      await addFile(store, "file.txt", "line 1\n");
      await git.commit().setMessage("Initial").setAuthor("Test Author", "test@example.com").call();

      const result = await git.blame().setFilePath("file.txt").call();

      const author = result.getSourceAuthor(1);
      expect(author?.name).toBe("Test Author");
      expect(author?.email).toBe("test@example.com");
    });
  });
});
