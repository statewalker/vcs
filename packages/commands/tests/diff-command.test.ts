/**
 * Tests for DiffCommand
 *
 * Based on JGit's DiffCommandTest.java
 */

import { describe, expect, it } from "vitest";

import { ChangeType } from "../src/index.js";
import { addFile, createInitializedGit } from "./test-helper.js";

describe("DiffCommand", () => {
  it("should return empty diff for same tree", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    const entries = await git.diff().setOldTree(initialCommitId).setNewTree(initialCommitId).call();

    expect(entries).toEqual([]);
  });

  it("should detect added files", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Add a file and commit
    await addFile(store, "new-file.txt", "content");
    await store.staging.write();
    const commit = await git.commit().setMessage("Add file").call();
    const commitId = await store.commits.storeCommit(commit);

    // Diff initial vs new commit
    const entries = await git.diff().setOldTree(initialCommitId).setNewTree(commitId).call();

    expect(entries.length).toBe(1);
    expect(entries[0].changeType).toBe(ChangeType.ADD);
    expect(entries[0].newPath).toBe("new-file.txt");
  });

  it("should detect deleted files", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Add a file and commit
    await addFile(store, "file.txt", "content");
    await store.staging.write();
    const commit1 = await git.commit().setMessage("Add file").call();
    const commit1Id = await store.commits.storeCommit(commit1);

    // Remove the file and commit
    const editor = store.staging.editor();
    editor.add({ path: "file.txt", apply: () => undefined });
    await editor.finish();
    await store.staging.write();
    const commit2 = await git.commit().setMessage("Remove file").call();
    const commit2Id = await store.commits.storeCommit(commit2);

    // Diff commit1 vs commit2
    const entries = await git.diff().setOldTree(commit1Id).setNewTree(commit2Id).call();

    expect(entries.length).toBe(1);
    expect(entries[0].changeType).toBe(ChangeType.DELETE);
    expect(entries[0].oldPath).toBe("file.txt");
  });

  it("should detect modified files", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Add a file and commit
    await addFile(store, "file.txt", "original content");
    await store.staging.write();
    const commit1 = await git.commit().setMessage("Add file").call();
    const commit1Id = await store.commits.storeCommit(commit1);

    // Modify the file and commit
    await addFile(store, "file.txt", "modified content");
    await store.staging.write();
    const commit2 = await git.commit().setMessage("Modify file").call();
    const commit2Id = await store.commits.storeCommit(commit2);

    // Diff commit1 vs commit2
    const entries = await git.diff().setOldTree(commit1Id).setNewTree(commit2Id).call();

    expect(entries.length).toBe(1);
    expect(entries[0].changeType).toBe(ChangeType.MODIFY);
    expect(entries[0].oldPath).toBe("file.txt");
    expect(entries[0].newPath).toBe("file.txt");
    expect(entries[0].oldId).not.toBe(entries[0].newId);
  });

  it("should detect multiple changes", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Add files and commit
    await addFile(store, "file1.txt", "content1");
    await addFile(store, "file2.txt", "content2");
    await addFile(store, "file3.txt", "content3");
    await store.staging.write();
    const commit1 = await git.commit().setMessage("Add files").call();
    const commit1Id = await store.commits.storeCommit(commit1);

    // Modify file1, delete file2, add file4
    await addFile(store, "file1.txt", "modified");
    const editor = store.staging.editor();
    editor.add({ path: "file2.txt", apply: () => undefined });
    await editor.finish();
    await addFile(store, "file4.txt", "new content");
    await store.staging.write();
    const commit2 = await git.commit().setMessage("Various changes").call();
    const commit2Id = await store.commits.storeCommit(commit2);

    // Diff
    const entries = await git.diff().setOldTree(commit1Id).setNewTree(commit2Id).call();

    expect(entries.length).toBe(3);

    const byPath = new Map(entries.map((e) => [e.newPath ?? e.oldPath, e]));

    expect(byPath.get("file1.txt")?.changeType).toBe(ChangeType.MODIFY);
    expect(byPath.get("file2.txt")?.changeType).toBe(ChangeType.DELETE);
    expect(byPath.get("file4.txt")?.changeType).toBe(ChangeType.ADD);
  });

  it("should filter by path prefix", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Add files in different directories
    await addFile(store, "src/main.ts", "main");
    await addFile(store, "src/lib/utils.ts", "utils");
    await addFile(store, "docs/readme.md", "readme");
    await store.staging.write();
    const commit = await git.commit().setMessage("Add files").call();
    const commitId = await store.commits.storeCommit(commit);

    // Diff with path filter
    const entries = await git
      .diff()
      .setOldTree(initialCommitId)
      .setNewTree(commitId)
      .setPathFilter("src/")
      .call();

    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.newPath?.startsWith("src/"))).toBe(true);
  });

  it("should use HEAD as default old tree", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Add file and commit
    await addFile(store, "file.txt", "content");
    await store.staging.write();
    const commit = await git.commit().setMessage("Add file").call();
    const _commitId = await store.commits.storeCommit(commit);

    // Stage another file
    await addFile(store, "staged.txt", "staged");
    await store.staging.write();

    // Diff with cached=true (HEAD vs staging)
    const entries = await git.diff().setCached(true).call();

    expect(entries.length).toBe(1);
    expect(entries[0].newPath).toBe("staged.txt");
    expect(entries[0].changeType).toBe(ChangeType.ADD);
  });

  it("should compare to staging with cached=true", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Add file and commit
    await addFile(store, "file.txt", "original");
    await store.staging.write();
    const commit = await git.commit().setMessage("Add file").call();
    const _commitId = await store.commits.storeCommit(commit);

    // Modify file in staging
    await addFile(store, "file.txt", "modified");
    await store.staging.write();

    // Diff cached
    const entries = await git.diff().setCached(true).call();

    expect(entries.length).toBe(1);
    expect(entries[0].changeType).toBe(ChangeType.MODIFY);
    expect(entries[0].newPath).toBe("file.txt");
  });

  it("should compare using branch names", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Create a file and commit on main
    await addFile(store, "file.txt", "content");
    await store.staging.write();
    await git.commit().setMessage("Add file").call();

    // Create branch1 at current point
    await git.branchCreate().setName("branch1").call();

    // Add another file to main
    await addFile(store, "another.txt", "another");
    await store.staging.write();
    await git.commit().setMessage("Add another").call();

    // Diff branch1 vs main
    const entries = await git
      .diff()
      .setOldTree("refs/heads/branch1")
      .setNewTree("refs/heads/main")
      .call();

    expect(entries.length).toBe(1);
    expect(entries[0].changeType).toBe(ChangeType.ADD);
    expect(entries[0].newPath).toBe("another.txt");
  });

  it("should sort entries by path", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Add files in random order
    await addFile(store, "z-file.txt", "z");
    await addFile(store, "a-file.txt", "a");
    await addFile(store, "m-file.txt", "m");
    await store.staging.write();
    const commit = await git.commit().setMessage("Add files").call();
    const commitId = await store.commits.storeCommit(commit);

    // Diff
    const entries = await git.diff().setOldTree(initialCommitId).setNewTree(commitId).call();

    expect(entries.length).toBe(3);
    expect(entries[0].newPath).toBe("a-file.txt");
    expect(entries[1].newPath).toBe("m-file.txt");
    expect(entries[2].newPath).toBe("z-file.txt");
  });

  it("should not be callable twice", async () => {
    const { git } = await createInitializedGit();

    const cmd = git.diff();
    await cmd.call();

    await expect(cmd.call()).rejects.toThrow(/already been called/);
  });

  it("should handle nested directories", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Add nested files
    await addFile(store, "a/b/c/deep.txt", "deep content");
    await addFile(store, "a/b/mid.txt", "mid content");
    await addFile(store, "a/top.txt", "top content");
    await store.staging.write();
    const commit = await git.commit().setMessage("Add nested files").call();
    const commitId = await store.commits.storeCommit(commit);

    // Diff
    const entries = await git.diff().setOldTree(initialCommitId).setNewTree(commitId).call();

    expect(entries.length).toBe(3);
    const paths = entries.map((e) => e.newPath);
    expect(paths).toContain("a/b/c/deep.txt");
    expect(paths).toContain("a/b/mid.txt");
    expect(paths).toContain("a/top.txt");
  });
});

describe("DiffEntry helpers", () => {
  it("should include object IDs for modifications", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Add file
    const blob1 = await addFile(store, "file.txt", "original");
    await store.staging.write();
    const commit1 = await git.commit().setMessage("Add").call();
    const commit1Id = await store.commits.storeCommit(commit1);

    // Modify file
    const blob2 = await addFile(store, "file.txt", "modified");
    await store.staging.write();
    const commit2 = await git.commit().setMessage("Modify").call();
    const commit2Id = await store.commits.storeCommit(commit2);

    const entries = await git.diff().setOldTree(commit1Id).setNewTree(commit2Id).call();

    expect(entries.length).toBe(1);
    expect(entries[0].oldId).toBe(blob1);
    expect(entries[0].newId).toBe(blob2);
  });
});
