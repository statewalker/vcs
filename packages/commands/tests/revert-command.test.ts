/**
 * Tests for RevertCommand
 *
 * Ported from JGit's RevertCommandTest.java
 */

import { describe, expect, it } from "vitest";

import { MultipleParentsNotAllowedError, RevertStatus } from "../src/index.js";
import { addFile, createInitializedGit, removeFile } from "./test-helper.js";

describe("RevertCommand", () => {
  /**
   * Test basic revert operation.
   *
   * Based on JGit's testRevert.
   */
  it("should revert a commit and generate correct message", async () => {
    const { git, store } = await createInitializedGit();

    // Create file a
    await addFile(store, "a.txt", "first line\nsec. line\nthird line\n");
    await git.commit().setMessage("create a").call();

    // Create file b
    await addFile(store, "b.txt", "content\n");
    await git.commit().setMessage("create b").call();

    // Enlarge a
    await addFile(store, "a.txt", "first line\nsec. line\nthird line\nfourth line\n");
    await git.commit().setMessage("enlarged a").call();

    // Fix a
    await addFile(store, "a.txt", "first line\nsecond line\nthird line\nfourth line\n");
    await git.commit().setMessage("fixed a").call();
    const fixingARef = await store.refs.resolve("HEAD");
    const fixingAId = fixingARef?.objectId ?? "";

    // Fix b
    await addFile(store, "b.txt", "first line\n");
    await git.commit().setMessage("fixed b").call();

    // Revert the fixingA commit
    const result = await git.revert().include(fixingAId).call();

    expect(result.status).toBe(RevertStatus.OK);
    expect(result.newHead).toBeDefined();
    expect(result.revertedRefs).toContain(fixingAId);

    // Check the revert commit message
    const revertCommit = await store.commits.loadCommit(result.newHead ?? "");
    expect(revertCommit.message).toContain('Revert "fixed a"');
    expect(revertCommit.message).toContain("This reverts commit");
    expect(revertCommit.message).toContain(fixingAId);

    // Check commit history
    const commits: string[] = [];
    for await (const commit of await git.log().call()) {
      commits.push(commit.message.split("\n")[0]);
    }

    expect(commits[0]).toBe('Revert "fixed a"');
    expect(commits[1]).toBe("fixed b");
    expect(commits[2]).toBe("fixed a");
    expect(commits[3]).toBe("enlarged a");
    expect(commits[4]).toBe("create b");
    expect(commits[5]).toBe("create a");
  });

  /**
   * Test reverting multiple commits sequentially.
   *
   * Based on JGit's testRevertMultiple.
   */
  it("should revert multiple commits in order", async () => {
    const { git, store } = await createInitializedGit();

    // Create initial state
    await addFile(store, "a.txt", "first\n");
    await git.commit().setMessage("add first").call();

    // Add second line
    await addFile(store, "a.txt", "first\nsecond\n");
    await git.commit().setMessage("add second").call();
    const secondCommitRef = await store.refs.resolve("HEAD");
    const secondCommit = secondCommitRef?.objectId ?? "";

    // Add third line
    await addFile(store, "a.txt", "first\nsecond\nthird\n");
    await git.commit().setMessage("add third").call();
    const thirdCommitRef = await store.refs.resolve("HEAD");
    const thirdCommit = thirdCommitRef?.objectId ?? "";

    // Revert both commits (third first, then second)
    const result = await git.revert().include(thirdCommit).include(secondCommit).call();

    expect(result.status).toBe(RevertStatus.OK);
    expect(result.revertedRefs).toHaveLength(2);

    // Check commit history - should have two revert commits
    const commits: string[] = [];
    for await (const commit of await git.log().call()) {
      commits.push(commit.message.split("\n")[0]);
    }

    expect(commits[0]).toBe('Revert "add second"');
    expect(commits[1]).toBe('Revert "add third"');
    expect(commits[2]).toBe("add third");
    expect(commits[3]).toBe("add second");
    expect(commits[4]).toBe("add first");
  });

  /**
   * Test revert with conflict.
   *
   * Based on JGit's testRevertConflictResolution.
   */
  it("should detect conflicts when reverting", async () => {
    const { git, store } = await createInitializedGit();

    // Create file a
    await addFile(store, "a.txt", "a");
    await git.commit().setMessage("first master").call();

    // Modify a - this is the commit we'll revert
    await addFile(store, "a.txt", "a(previous)");
    await git.commit().setMessage("second master").call();
    const oldCommitRef = await store.refs.resolve("HEAD");
    const oldCommit = oldCommitRef?.objectId ?? "";

    // Modify a again - creates conflict with revert
    await addFile(store, "a.txt", "a(latest)");
    await git.commit().setMessage("side").call();

    // Try to revert - should conflict
    const result = await git.revert().include(oldCommit).call();

    expect(result.status).toBe(RevertStatus.CONFLICTING);
    expect(result.conflicts).toContain("a.txt");

    // Verify conflict stages in staging
    const hasConflicts = await store.staging.hasConflicts();
    expect(hasConflicts).toBe(true);

    const entries = await store.staging.getEntries("a.txt");
    expect(entries.length).toBeGreaterThan(1);
  });

  /**
   * Test revert with noCommit option.
   */
  it("should revert without committing when noCommit is true", async () => {
    const { git, store } = await createInitializedGit();

    // Create base file
    await addFile(store, "a.txt", "original");
    await git.commit().setMessage("base").call();
    const baseCommitRef = await store.refs.resolve("HEAD");
    const baseCommit = baseCommitRef?.objectId ?? "";

    // Modify file
    await addFile(store, "a.txt", "modified");
    await git.commit().setMessage("modify").call();
    const modifyCommitRef = await store.refs.resolve("HEAD");
    const modifyCommit = modifyCommitRef?.objectId ?? "";

    const beforeRevertHead = await store.refs.resolve("HEAD");

    // Revert with noCommit
    const result = await git.revert().include(modifyCommit).setNoCommit(true).call();

    expect(result.status).toBe(RevertStatus.OK);

    // HEAD should not have moved
    const afterRevertHead = await store.refs.resolve("HEAD");
    expect(afterRevertHead?.objectId).toBe(beforeRevertHead?.objectId);

    // But staging should reflect the reverted content
    const entry = await store.staging.getEntry("a.txt");
    expect(entry).toBeDefined();

    // The tree in staging should match the base commit's tree content
    const baseCommitData = await store.commits.loadCommit(baseCommit);
    const stagingTreeId = await store.staging.writeTree(store.trees);
    // The trees should be identical since we reverted to base
    expect(stagingTreeId).toBe(baseCommitData.tree);
  });

  /**
   * Test reverting a merge commit requires mainline parent.
   */
  it("should throw error when reverting merge commit without mainline parent", async () => {
    const { git, store } = await createInitializedGit();

    // Create base
    await addFile(store, "file.txt", "base");
    await git.commit().setMessage("base").call();
    const baseCommit = await store.refs.resolve("HEAD");

    // Create side branch
    await git
      .branchCreate()
      .setName("side")
      .setStartPoint(baseCommit?.objectId ?? "")
      .call();

    // Modify on main
    await addFile(store, "main.txt", "main");
    await git.commit().setMessage("main change").call();
    const mainHead = await store.refs.resolve("HEAD");

    // Checkout side and modify
    await store.refs.setSymbolic("HEAD", "refs/heads/side");
    const baseCommitData = await store.commits.loadCommit(baseCommit?.objectId ?? "");
    await store.staging.readTree(store.trees, baseCommitData.tree);
    await addFile(store, "side.txt", "side");
    await git.commit().setMessage("side change").call();

    // Merge main into side
    const mergeResult = await git
      .merge()
      .include(mainHead?.objectId ?? "")
      .call();
    const mergeCommit = mergeResult.newHead;

    // Try to revert merge commit without mainline parent
    await expect(
      git
        .revert()
        .include(mergeCommit ?? "")
        .call(),
    ).rejects.toThrow(MultipleParentsNotAllowedError);
  });

  /**
   * Test reverting a merge commit with mainline parent specified.
   */
  it("should revert merge commit when mainline parent is specified", async () => {
    const { git, store } = await createInitializedGit();

    // Create base commit
    await addFile(store, "file.txt", "base content");
    await git.commit().setMessage("base").call();
    const baseCommit = await store.refs.resolve("HEAD");

    // Create side branch
    await git
      .branchCreate()
      .setName("side")
      .setStartPoint(baseCommit?.objectId ?? "")
      .call();

    // Modify on main - add a new file
    await addFile(store, "main-file.txt", "from main");
    await git.commit().setMessage("main add").call();
    const mainHead = await store.refs.resolve("HEAD");

    // Checkout side and add different file
    await store.refs.setSymbolic("HEAD", "refs/heads/side");
    const baseCommitData = await store.commits.loadCommit(baseCommit?.objectId ?? "");
    await store.staging.readTree(store.trees, baseCommitData.tree);
    await addFile(store, "side-file.txt", "from side");
    await git.commit().setMessage("side add").call();

    // Merge main into side
    const mergeResult = await git
      .merge()
      .include(mainHead?.objectId ?? "")
      .call();
    const mergeCommit = mergeResult.newHead;

    // Revert with mainline parent 1 (side is parent 1)
    // This means we diff merge commit against side, and revert main's changes
    const result = await git
      .revert()
      .include(mergeCommit ?? "")
      .setMainlineParentNumber(1)
      .call();

    expect(result.status).toBe(RevertStatus.OK);

    // main-file.txt should be removed (reverted)
    const mainFileEntry = await store.staging.getEntry("main-file.txt");
    expect(mainFileEntry).toBeUndefined();

    // side-file.txt should still exist
    const sideFileEntry = await store.staging.getEntry("side-file.txt");
    expect(sideFileEntry).toBeDefined();
  });

  /**
   * Test error when specifying invalid mainline parent number.
   */
  it("should throw error for invalid mainline parent number", async () => {
    const { git, store } = await createInitializedGit();

    // Create a merge commit
    await addFile(store, "file.txt", "content");
    await git.commit().setMessage("base").call();
    const baseCommit = await store.refs.resolve("HEAD");

    await git
      .branchCreate()
      .setName("side")
      .setStartPoint(baseCommit?.objectId ?? "")
      .call();

    await addFile(store, "main.txt", "main");
    await git.commit().setMessage("main").call();
    const mainHead = await store.refs.resolve("HEAD");

    await store.refs.setSymbolic("HEAD", "refs/heads/side");
    const baseCommitData = await store.commits.loadCommit(baseCommit?.objectId ?? "");
    await store.staging.readTree(store.trees, baseCommitData.tree);
    await addFile(store, "side.txt", "side");
    await git.commit().setMessage("side").call();

    const mergeResult = await git
      .merge()
      .include(mainHead?.objectId ?? "")
      .call();
    const mergeCommit = mergeResult.newHead;

    // Try with invalid parent number 3 (merge has only 2 parents)
    await expect(
      git
        .revert()
        .include(mergeCommit ?? "")
        .setMainlineParentNumber(3)
        .call(),
    ).rejects.toThrow("Invalid mainline parent: 3");
  });

  /**
   * Test revert where file is added in reverted commit (should be deleted).
   */
  it("should handle file addition revert (delete the file)", async () => {
    const { git, store } = await createInitializedGit();

    // Create base
    await addFile(store, "existing.txt", "exists");
    await git.commit().setMessage("base").call();

    // Add new file
    await addFile(store, "new-file.txt", "new content");
    await git.commit().setMessage("add new file").call();
    const addCommitRef = await store.refs.resolve("HEAD");
    const addCommit = addCommitRef?.objectId ?? "";

    // Verify file exists
    let entry = await store.staging.getEntry("new-file.txt");
    expect(entry).toBeDefined();

    // Revert the add - should delete the file
    const result = await git.revert().include(addCommit).call();

    expect(result.status).toBe(RevertStatus.OK);

    // new-file.txt should be gone
    entry = await store.staging.getEntry("new-file.txt");
    expect(entry).toBeUndefined();

    // existing.txt should still exist
    const existingEntry = await store.staging.getEntry("existing.txt");
    expect(existingEntry).toBeDefined();
  });

  /**
   * Test revert where file is deleted in reverted commit (should be restored).
   */
  it("should handle file deletion revert (restore the file)", async () => {
    const { git, store } = await createInitializedGit();

    // Create base with file
    await addFile(store, "deleteme.txt", "content to restore");
    await addFile(store, "keep.txt", "keep this");
    await git.commit().setMessage("base").call();

    // Delete file
    await removeFile(store, "deleteme.txt");
    await git.commit().setMessage("delete file").call();
    const deleteCommitRef = await store.refs.resolve("HEAD");
    const deleteCommit = deleteCommitRef?.objectId ?? "";

    // Verify file is gone
    let entry = await store.staging.getEntry("deleteme.txt");
    expect(entry).toBeUndefined();

    // Revert the delete - should restore the file
    const result = await git.revert().include(deleteCommit).call();

    expect(result.status).toBe(RevertStatus.OK);

    // deleteme.txt should be restored
    entry = await store.staging.getEntry("deleteme.txt");
    expect(entry).toBeDefined();
  });

  /**
   * Test revert delete/modify conflict.
   */
  it("should detect delete/modify conflict when reverting", async () => {
    const { git, store } = await createInitializedGit();

    // Create base with file
    await addFile(store, "conflict.txt", "original");
    await git.commit().setMessage("base").call();

    // Delete the file - this is the commit we'll revert
    await removeFile(store, "conflict.txt");
    await git.commit().setMessage("delete file").call();
    const deleteCommit2Ref = await store.refs.resolve("HEAD");
    const deleteCommit2 = deleteCommit2Ref?.objectId ?? "";

    // Add a different file - so we have a clean new state
    await addFile(store, "other.txt", "other");
    await git.commit().setMessage("add other").call();

    // Now modify the staging to have conflict.txt with different content
    // (simulating concurrent work that added it back differently)
    await addFile(store, "conflict.txt", "different content");
    await git.commit().setMessage("add back with different content").call();

    // Revert the delete commit - should conflict because:
    // - Revert wants to restore "original"
    // - Current state has "different content"
    const result = await git.revert().include(deleteCommit2).call();

    expect(result.status).toBe(RevertStatus.CONFLICTING);
    expect(result.conflicts).toContain("conflict.txt");
  });
});

describe("RevertCommand - JGit additional tests", () => {
  /**
   * Test that reverted commits have correct parentage.
   */
  it("should set correct parent for revert commit", async () => {
    const { git, store } = await createInitializedGit();

    // Create base with file a
    await addFile(store, "a.txt", "a");
    await git.commit().setMessage("base").call();

    // Add a new file b - this is the commit we'll revert
    await addFile(store, "b.txt", "b content");
    await git.commit().setMessage("add b").call();
    const addBCommitRef = await store.refs.resolve("HEAD");
    const addBCommit = addBCommitRef?.objectId ?? "";

    // Add another file c - so we have a clean HEAD to revert onto
    await addFile(store, "c.txt", "c content");
    await git.commit().setMessage("add c").call();
    const headBeforeRevertRef = await store.refs.resolve("HEAD");
    const headBeforeRevert = headBeforeRevertRef?.objectId ?? "";

    // Revert the add b commit (should cleanly delete b.txt)
    const result = await git.revert().include(addBCommit).call();

    expect(result.status).toBe(RevertStatus.OK);

    // The new commit's parent should be headBeforeRevert
    const revertCommit = await store.commits.loadCommit(result.newHead ?? "");
    expect(revertCommit.parents).toHaveLength(1);
    expect(revertCommit.parents[0]).toBe(headBeforeRevert);
  });

  /**
   * Test revert message format with multi-line original message.
   */
  it("should use only first line of original message in revert title", async () => {
    const { git, store } = await createInitializedGit();

    // Create base
    await addFile(store, "a.txt", "a");
    await git.commit().setMessage("base").call();

    // Create commit with multi-line message
    await addFile(store, "a.txt", "b");
    const detailedMessage = "Fix the bug\n\nThis is a detailed description\nWith multiple lines";
    await git.commit().setMessage(detailedMessage).call();
    const fixCommitRef = await store.refs.resolve("HEAD");
    const fixCommit = fixCommitRef?.objectId ?? "";

    // Make another commit so revert is clean
    await addFile(store, "c.txt", "c");
    await git.commit().setMessage("add c").call();

    // Revert
    const result = await git.revert().include(fixCommit).call();

    expect(result.status).toBe(RevertStatus.OK);

    // Check message uses only first line in title
    const revertCommit = await store.commits.loadCommit(result.newHead ?? "");
    expect(revertCommit.message).toContain('Revert "Fix the bug"');
    expect(revertCommit.message).not.toContain("This is a detailed description");
  });

  /**
   * Test that revert of a file modification produces original content.
   */
  it("should restore original content when reverting modification", async () => {
    const { git, store } = await createInitializedGit();

    // Create base with specific content
    const originalContent = "original content here";
    await addFile(store, "file.txt", originalContent);
    await git.commit().setMessage("base").call();
    const baseCommit2Ref = await store.refs.resolve("HEAD");
    const baseCommit2 = baseCommit2Ref?.objectId ?? "";

    // Modify the file
    await addFile(store, "file.txt", "modified content");
    await git.commit().setMessage("modify file").call();
    const modifyCommit2Ref = await store.refs.resolve("HEAD");
    const modifyCommit2 = modifyCommit2Ref?.objectId ?? "";

    // Revert the modification
    const result = await git.revert().include(modifyCommit2).call();

    expect(result.status).toBe(RevertStatus.OK);

    // Read the tree to verify content matches base
    const revertCommit = await store.commits.loadCommit(result.newHead ?? "");
    const baseCommitData = await store.commits.loadCommit(baseCommit2);

    // Get file entry from both trees
    let revertFileId: string | undefined;
    let baseFileId: string | undefined;

    for await (const entry of store.trees.loadTree(revertCommit.tree)) {
      if (entry.name === "file.txt") {
        revertFileId = entry.id;
      }
    }

    for await (const entry of store.trees.loadTree(baseCommitData.tree)) {
      if (entry.name === "file.txt") {
        baseFileId = entry.id;
      }
    }

    // The blob IDs should match (same content)
    expect(revertFileId).toBe(baseFileId);
  });
});
