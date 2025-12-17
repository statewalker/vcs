/**
 * Tests for CherryPickCommand
 *
 * Ported from JGit's CherryPickCommandTest.java
 */

import { describe, expect, it } from "vitest";

import {
  CherryPickStatus,
  ContentMergeStrategy,
  MergeStrategy,
  MultipleParentsNotAllowedError,
} from "../src/index.js";
import { addFile, createInitializedGit, removeFile } from "./test-helper.js";

describe("CherryPickCommand", () => {
  /**
   * Test basic cherry-pick operation with conflict.
   *
   * Based on JGit's testCherryPick prepareCherryPick pattern.
   */
  it("should detect conflicts when both sides modify same file", async () => {
    const { git, store } = await createInitializedGit();

    // Create file a on main
    await addFile(store, "a.txt", "a");
    await git.commit().setMessage("first master").call();
    const firstMaster = await store.refs.resolve("HEAD");

    // Create and checkout side branch
    await git
      .branchCreate()
      .setName("side")
      .setStartPoint(firstMaster?.objectId ?? "")
      .call();
    await store.refs.setSymbolic("HEAD", "refs/heads/side");
    const firstCommit = await store.commits.loadCommit(firstMaster?.objectId ?? "");
    await store.staging.readTree(store.trees, firstCommit.tree);

    // Modify a on side branch
    await addFile(store, "a.txt", "a(side)");
    await git.commit().setMessage("side").call();
    const sideCommit = await store.refs.resolve("HEAD");

    // Checkout main
    await store.refs.setSymbolic("HEAD", "refs/heads/main");
    await store.staging.readTree(store.trees, firstCommit.tree);

    // Modify a on main differently
    await addFile(store, "a.txt", "a(master)");
    await git.commit().setMessage("second master").call();

    // Cherry-pick side commit - should conflict
    const result = await git
      .cherryPick()
      .include(sideCommit?.objectId ?? "")
      .call();

    expect(result.status).toBe(CherryPickStatus.CONFLICTING);
    expect(result.conflicts).toContain("a.txt");

    // Verify conflict stages in staging
    const hasConflicts = await store.staging.hasConflicts();
    expect(hasConflicts).toBe(true);

    // Check that we have entries at different stages
    const entries = await store.staging.getEntries("a.txt");
    expect(entries.length).toBeGreaterThan(1);
  });

  /**
   * Test cherry-pick with noCommit option.
   *
   * Based on JGit's testCherryPickNoCommit.
   */
  it("should cherry-pick without committing when noCommit is true", async () => {
    const { git, store } = await createInitializedGit();

    // Create initial state
    await addFile(store, "a.txt", "initial");
    await git.commit().setMessage("initial").call();
    const initialCommit = await store.refs.resolve("HEAD");

    // Create side branch
    await git
      .branchCreate()
      .setName("side")
      .setStartPoint(initialCommit?.objectId ?? "")
      .call();
    await store.refs.setSymbolic("HEAD", "refs/heads/side");
    const firstCommitData = await store.commits.loadCommit(initialCommit?.objectId ?? "");
    await store.staging.readTree(store.trees, firstCommitData.tree);

    // Add new file on side branch
    await addFile(store, "b.txt", "side file");
    await git.commit().setMessage("add b on side").call();
    const sideCommit = await store.refs.resolve("HEAD");

    // Checkout main
    await store.refs.setSymbolic("HEAD", "refs/heads/main");
    await store.staging.readTree(store.trees, firstCommitData.tree);

    // Cherry-pick with noCommit
    const result = await git
      .cherryPick()
      .include(sideCommit?.objectId ?? "")
      .setNoCommit(true)
      .call();

    expect(result.status).toBe(CherryPickStatus.OK);

    // HEAD should not have moved
    const newHeadRef = await store.refs.resolve("HEAD");
    expect(newHeadRef?.objectId).toBe(initialCommit?.objectId);

    // But staging should have the new file
    const entry = await store.staging.getEntry("b.txt");
    expect(entry).toBeDefined();
  });

  /**
   * Test sequential cherry-picking of multiple commits.
   *
   * Based on JGit's testSequentialCherryPick.
   */
  it("should cherry-pick multiple commits sequentially", async () => {
    const { git, store } = await createInitializedGit();

    // Create file a
    await addFile(store, "a.txt", "line 1\n");
    await git.commit().setMessage("create a").call();
    const commit1 = await store.refs.resolve("HEAD");

    // Modify file a
    await addFile(store, "a.txt", "line 1\nline 2\n");
    await git.commit().setMessage("modify a").call();
    const commit2 = await store.refs.resolve("HEAD");

    // Further modify file a
    await addFile(store, "a.txt", "line 1\nline 2\nline 3\n");
    await git.commit().setMessage("further modify a").call();
    const commit3 = await store.refs.resolve("HEAD");

    // Create side branch at commit1
    await git
      .branchCreate()
      .setName("side")
      .setStartPoint(commit1?.objectId ?? "")
      .call();

    // Checkout side
    await store.refs.setSymbolic("HEAD", "refs/heads/side");
    const commit1Data = await store.commits.loadCommit(commit1?.objectId ?? "");
    await store.staging.readTree(store.trees, commit1Data.tree);

    // Add different file on side
    await addFile(store, "b.txt", "side content");
    await git.commit().setMessage("create b on side").call();

    // Cherry-pick both commits from main
    const result = await git
      .cherryPick()
      .include(commit2?.objectId ?? "")
      .include(commit3?.objectId ?? "")
      .call();

    expect(result.status).toBe(CherryPickStatus.OK);
    expect(result.cherryPickedRefs).toHaveLength(2);

    // Verify commit history
    const commits: string[] = [];
    for await (const commit of await git.log().call()) {
      commits.push(commit.message);
    }

    expect(commits[0]).toBe("further modify a");
    expect(commits[1]).toBe("modify a");
    expect(commits[2]).toBe("create b on side");
    expect(commits[3]).toBe("create a");
  });

  /**
   * Test cherry-picking a merge commit requires mainline parent.
   *
   * Based on JGit's testCherryPickMerge.
   */
  it("should throw error when cherry-picking merge commit without mainline parent", async () => {
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

    // Create target branch to cherry-pick onto
    await git
      .branchCreate()
      .setName("target")
      .setStartPoint(baseCommit?.objectId ?? "")
      .call();
    await store.refs.setSymbolic("HEAD", "refs/heads/target");
    await store.staging.readTree(store.trees, baseCommitData.tree);

    // Try to cherry-pick merge commit without mainline parent
    await expect(
      git
        .cherryPick()
        .include(mergeCommit ?? "")
        .call(),
    ).rejects.toThrow(MultipleParentsNotAllowedError);
  });

  /**
   * Test cherry-picking a merge commit with mainline parent specified.
   *
   * Based on JGit's testCherryPickMerge (success cases).
   */
  it("should cherry-pick merge commit when mainline parent is specified", async () => {
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

    // Create target branch from base
    await git
      .branchCreate()
      .setName("target")
      .setStartPoint(baseCommit?.objectId ?? "")
      .call();
    await store.refs.setSymbolic("HEAD", "refs/heads/target");
    await store.staging.readTree(store.trees, baseCommitData.tree);

    // Cherry-pick with mainline parent 1 (side is parent 1)
    // This means we diff merge commit against side, so we get main's changes
    const result = await git
      .cherryPick()
      .include(mergeCommit ?? "")
      .setMainlineParentNumber(1)
      .call();

    expect(result.status).toBe(CherryPickStatus.OK);

    // Should have the main-file.txt from cherry-pick
    const entry = await store.staging.getEntry("main-file.txt");
    expect(entry).toBeDefined();
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

    // Go to target
    await git
      .branchCreate()
      .setName("target")
      .setStartPoint(baseCommit?.objectId ?? "")
      .call();
    await store.refs.setSymbolic("HEAD", "refs/heads/target");
    await store.staging.readTree(store.trees, baseCommitData.tree);

    // Try with invalid parent number 3 (merge has only 2 parents)
    await expect(
      git
        .cherryPick()
        .include(mergeCommit ?? "")
        .setMainlineParentNumber(3)
        .call(),
    ).rejects.toThrow("Invalid mainline parent: 3");
  });

  /**
   * Test cherry-pick where file is added in cherry-picked commit.
   */
  it("should handle file addition in cherry-pick", async () => {
    const { git, store } = await createInitializedGit();

    // Create base
    await addFile(store, "existing.txt", "exists");
    await git.commit().setMessage("base").call();
    const baseCommit = await store.refs.resolve("HEAD");

    // Create side branch
    await git
      .branchCreate()
      .setName("side")
      .setStartPoint(baseCommit?.objectId ?? "")
      .call();

    // Add new file on main
    await addFile(store, "new-main.txt", "from main");
    await git.commit().setMessage("add file on main").call();

    // Checkout side and add different file
    await store.refs.setSymbolic("HEAD", "refs/heads/side");
    const baseCommitData = await store.commits.loadCommit(baseCommit?.objectId ?? "");
    await store.staging.readTree(store.trees, baseCommitData.tree);
    await addFile(store, "new-side.txt", "from side");
    await git.commit().setMessage("add file on side").call();
    const sideCommit = await store.refs.resolve("HEAD");

    // Checkout main
    await store.refs.setSymbolic("HEAD", "refs/heads/main");
    const mainRef = await store.refs.resolve("refs/heads/main");
    const mainData = await store.commits.loadCommit(mainRef?.objectId ?? "");
    await store.staging.readTree(store.trees, mainData.tree);

    // Cherry-pick side - should add new-side.txt cleanly
    const result = await git
      .cherryPick()
      .include(sideCommit?.objectId ?? "")
      .call();

    expect(result.status).toBe(CherryPickStatus.OK);

    // Both files should exist
    const mainFile = await store.staging.getEntry("new-main.txt");
    const sideFile = await store.staging.getEntry("new-side.txt");
    expect(mainFile).toBeDefined();
    expect(sideFile).toBeDefined();
  });

  /**
   * Test cherry-pick where file is deleted in cherry-picked commit.
   */
  it("should handle file deletion in cherry-pick", async () => {
    const { git, store } = await createInitializedGit();

    // Create base with two files
    await addFile(store, "keep.txt", "keep");
    await addFile(store, "delete.txt", "delete");
    await git.commit().setMessage("base").call();
    const baseCommit = await store.refs.resolve("HEAD");

    // Create side branch
    await git
      .branchCreate()
      .setName("side")
      .setStartPoint(baseCommit?.objectId ?? "")
      .call();

    // On main, just keep files as is (empty commit)
    await git.commit().setMessage("main no change").setAllowEmpty(true).call();

    // Checkout side and delete the file
    await store.refs.setSymbolic("HEAD", "refs/heads/side");
    const baseCommitData = await store.commits.loadCommit(baseCommit?.objectId ?? "");
    await store.staging.readTree(store.trees, baseCommitData.tree);

    // Remove delete.txt from staging
    await removeFile(store, "delete.txt");
    await git.commit().setMessage("delete file on side").call();
    const sideCommit = await store.refs.resolve("HEAD");

    // Checkout main
    await store.refs.setSymbolic("HEAD", "refs/heads/main");
    const mainRef = await store.refs.resolve("refs/heads/main");
    const mainData = await store.commits.loadCommit(mainRef?.objectId ?? "");
    await store.staging.readTree(store.trees, mainData.tree);

    // Cherry-pick side - should delete delete.txt
    const result = await git
      .cherryPick()
      .include(sideCommit?.objectId ?? "")
      .call();

    expect(result.status).toBe(CherryPickStatus.OK);

    // delete.txt should be gone, keep.txt should exist
    const keepFile = await store.staging.getEntry("keep.txt");
    const deleteFile = await store.staging.getEntry("delete.txt");
    expect(keepFile).toBeDefined();
    expect(deleteFile).toBeUndefined();
  });

  /**
   * Test cherry-pick delete/modify conflict.
   */
  it("should detect delete/modify conflict", async () => {
    const { git, store } = await createInitializedGit();

    // Create base with file
    await addFile(store, "conflict.txt", "original");
    await git.commit().setMessage("base").call();
    const baseCommit = await store.refs.resolve("HEAD");

    // Create side branch
    await git
      .branchCreate()
      .setName("side")
      .setStartPoint(baseCommit?.objectId ?? "")
      .call();

    // On main, delete the file
    await removeFile(store, "conflict.txt");
    await git.commit().setMessage("delete on main").call();

    // Checkout side and modify the file
    await store.refs.setSymbolic("HEAD", "refs/heads/side");
    const baseCommitData = await store.commits.loadCommit(baseCommit?.objectId ?? "");
    await store.staging.readTree(store.trees, baseCommitData.tree);
    await addFile(store, "conflict.txt", "modified");
    await git.commit().setMessage("modify on side").call();
    const sideCommit = await store.refs.resolve("HEAD");

    // Checkout main
    await store.refs.setSymbolic("HEAD", "refs/heads/main");
    const mainRef = await store.refs.resolve("refs/heads/main");
    const mainData = await store.commits.loadCommit(mainRef?.objectId ?? "");
    await store.staging.readTree(store.trees, mainData.tree);

    // Cherry-pick side - should conflict (we deleted, they modified)
    const result = await git
      .cherryPick()
      .include(sideCommit?.objectId ?? "")
      .call();

    expect(result.status).toBe(CherryPickStatus.CONFLICTING);
    expect(result.conflicts).toContain("conflict.txt");
  });
});

describe("CherryPickCommand - Strategy and options", () => {
  /**
   * Test setStrategy/getStrategy.
   *
   * Based on JGit's setStrategy pattern.
   */
  it("should support setting merge strategy", async () => {
    const { git } = await createInitializedGit();

    const command = git.cherryPick();
    expect(command.getStrategy()).toBe(MergeStrategy.RECURSIVE); // default

    command.setStrategy(MergeStrategy.RESOLVE);
    expect(command.getStrategy()).toBe(MergeStrategy.RESOLVE);

    command.setStrategy(MergeStrategy.OURS);
    expect(command.getStrategy()).toBe(MergeStrategy.OURS);
  });

  /**
   * Test setContentMergeStrategy/getContentMergeStrategy.
   *
   * Based on JGit's content merge strategy options.
   */
  it("should support setting content merge strategy", async () => {
    const { git } = await createInitializedGit();

    const command = git.cherryPick();
    expect(command.getContentMergeStrategy()).toBeUndefined(); // no default

    command.setContentMergeStrategy(ContentMergeStrategy.OURS);
    expect(command.getContentMergeStrategy()).toBe(ContentMergeStrategy.OURS);

    command.setContentMergeStrategy(ContentMergeStrategy.THEIRS);
    expect(command.getContentMergeStrategy()).toBe(ContentMergeStrategy.THEIRS);
  });

  /**
   * Test setOurCommitName/getOurCommitName.
   *
   * Based on JGit's setOurCommitName for conflict markers.
   */
  it("should support setting our commit name for conflict markers", async () => {
    const { git } = await createInitializedGit();

    const command = git.cherryPick();
    expect(command.getOurCommitName()).toBeUndefined(); // default

    command.setOurCommitName("feature-branch");
    expect(command.getOurCommitName()).toBe("feature-branch");
  });

  /**
   * Test setReflogPrefix/getReflogPrefix.
   *
   * Based on JGit's reflog handling.
   */
  it("should support setting reflog prefix", async () => {
    const { git } = await createInitializedGit();

    const command = git.cherryPick();
    expect(command.getReflogPrefix()).toBe("cherry-pick:"); // default

    command.setReflogPrefix("revert:");
    expect(command.getReflogPrefix()).toBe("revert:");
  });

  /**
   * Test that options are correctly maintained through fluent API.
   */
  it("should chain all options fluently", async () => {
    const { git, store } = await createInitializedGit();

    // Create setup for cherry-pick
    await addFile(store, "a.txt", "a");
    await git.commit().setMessage("base").call();
    const baseCommit = await store.refs.resolve("HEAD");

    await git
      .branchCreate()
      .setName("side")
      .setStartPoint(baseCommit?.objectId ?? "")
      .call();
    await store.refs.setSymbolic("HEAD", "refs/heads/side");
    const baseCommitData = await store.commits.loadCommit(baseCommit?.objectId ?? "");
    await store.staging.readTree(store.trees, baseCommitData.tree);

    await addFile(store, "b.txt", "b");
    await git.commit().setMessage("side commit").call();
    const sideCommit = await store.refs.resolve("HEAD");

    await store.refs.setSymbolic("HEAD", "refs/heads/main");
    await store.staging.readTree(store.trees, baseCommitData.tree);

    // Chain all options
    const result = await git
      .cherryPick()
      .include(sideCommit?.objectId ?? "")
      .setStrategy(MergeStrategy.RECURSIVE)
      .setContentMergeStrategy(ContentMergeStrategy.OURS)
      .setOurCommitName("HEAD")
      .setReflogPrefix("cherry-pick:")
      .call();

    expect(result.status).toBe(CherryPickStatus.OK);
  });
});

describe("CherryPickCommand - JGit additional tests", () => {
  /**
   * Test cherry-picking preserves original author.
   */
  it("should preserve original commit author", async () => {
    const { git, store } = await createInitializedGit();

    // Create base
    await addFile(store, "a.txt", "a");
    await git.commit().setMessage("base").call();
    const baseCommit = await store.refs.resolve("HEAD");

    // Create side with custom author
    await git
      .branchCreate()
      .setName("side")
      .setStartPoint(baseCommit?.objectId ?? "")
      .call();
    await store.refs.setSymbolic("HEAD", "refs/heads/side");
    const baseCommitData = await store.commits.loadCommit(baseCommit?.objectId ?? "");
    await store.staging.readTree(store.trees, baseCommitData.tree);

    // Add file with custom author
    await addFile(store, "b.txt", "new content");
    await git
      .commit()
      .setMessage("commit with custom author")
      .setAuthor("Custom Author", "custom@example.com")
      .call();
    const sideCommit = await store.refs.resolve("HEAD");

    // Checkout main
    await store.refs.setSymbolic("HEAD", "refs/heads/main");
    await store.staging.readTree(store.trees, baseCommitData.tree);

    // Cherry-pick
    const result = await git
      .cherryPick()
      .include(sideCommit?.objectId ?? "")
      .call();

    expect(result.status).toBe(CherryPickStatus.OK);

    // Check the new commit preserves the original author
    const newCommit = await store.commits.loadCommit(result.newHead ?? "");
    expect(newCommit.author.name).toBe("Custom Author");
    expect(newCommit.author.email).toBe("custom@example.com");
  });

  /**
   * Test cherry-picking preserves original commit message.
   */
  it("should preserve original commit message", async () => {
    const { git, store } = await createInitializedGit();

    // Create base
    await addFile(store, "a.txt", "a");
    await git.commit().setMessage("base").call();
    const baseCommit = await store.refs.resolve("HEAD");

    await git
      .branchCreate()
      .setName("side")
      .setStartPoint(baseCommit?.objectId ?? "")
      .call();
    await store.refs.setSymbolic("HEAD", "refs/heads/side");
    const baseCommitData = await store.commits.loadCommit(baseCommit?.objectId ?? "");
    await store.staging.readTree(store.trees, baseCommitData.tree);

    const detailedMessage =
      "This is a detailed commit message\n\nWith multiple lines\nAnd description";
    await addFile(store, "b.txt", "new file");
    await git.commit().setMessage(detailedMessage).call();
    const sideCommit = await store.refs.resolve("HEAD");

    // Checkout main
    await store.refs.setSymbolic("HEAD", "refs/heads/main");
    await store.staging.readTree(store.trees, baseCommitData.tree);

    // Cherry-pick
    const result = await git
      .cherryPick()
      .include(sideCommit?.objectId ?? "")
      .call();

    expect(result.status).toBe(CherryPickStatus.OK);

    const newCommit = await store.commits.loadCommit(result.newHead ?? "");
    expect(newCommit.message).toBe(detailedMessage);
  });

  /**
   * Test that cherry-picked commits have correct parentage.
   */
  it("should set correct parent for cherry-picked commit", async () => {
    const { git, store } = await createInitializedGit();

    // Create base
    await addFile(store, "a.txt", "a");
    await git.commit().setMessage("base").call();
    const baseCommit = await store.refs.resolve("HEAD");

    await git
      .branchCreate()
      .setName("side")
      .setStartPoint(baseCommit?.objectId ?? "")
      .call();
    await store.refs.setSymbolic("HEAD", "refs/heads/side");
    const baseCommitData = await store.commits.loadCommit(baseCommit?.objectId ?? "");
    await store.staging.readTree(store.trees, baseCommitData.tree);

    await addFile(store, "b.txt", "b");
    await git.commit().setMessage("side commit").call();
    const sideCommit = await store.refs.resolve("HEAD");

    // Checkout main and make another commit
    await store.refs.setSymbolic("HEAD", "refs/heads/main");
    await store.staging.readTree(store.trees, baseCommitData.tree);
    await addFile(store, "c.txt", "c");
    await git.commit().setMessage("main commit 2").call();
    const mainCommit2 = await store.refs.resolve("HEAD");

    // Cherry-pick
    const result = await git
      .cherryPick()
      .include(sideCommit?.objectId ?? "")
      .call();

    expect(result.status).toBe(CherryPickStatus.OK);

    // The new commit's parent should be mainCommit2
    const newCommit = await store.commits.loadCommit(result.newHead ?? "");
    expect(newCommit.parents).toHaveLength(1);
    expect(newCommit.parents[0]).toBe(mainCommit2?.objectId);
  });
});
