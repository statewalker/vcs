/**
 * Tests for MergeCommand
 *
 * Based on JGit's MergeCommandTest.java
 */

import { describe, expect, it } from "vitest";

import {
  FastForwardMode,
  InvalidMergeHeadsError,
  MergeStatus,
  NotFastForwardError,
} from "../src/index.js";
import { addFile, createInitializedGit, toArray } from "./test-helper.js";

describe("MergeCommand", () => {
  // ===== Already Up To Date =====

  describe("already up to date", () => {
    /**
     * JGit: testMergeInItself
     */
    it("should report ALREADY_UP_TO_DATE when merging HEAD into itself", async () => {
      const { git, initialCommitId } = await createInitializedGit();

      const result = await git.merge().include("HEAD").call();

      expect(result.status).toBe(MergeStatus.ALREADY_UP_TO_DATE);
      expect(result.newHead).toBe(initialCommitId);
    });

    /**
     * JGit: testAlreadyUpToDate
     */
    it("should report ALREADY_UP_TO_DATE when source is ancestor of HEAD", async () => {
      const { git, store, initialCommitId } = await createInitializedGit();

      // Create a branch at initial commit
      await git.branchCreate().setName("branch1").setStartPoint(initialCommitId).call();

      // Add another commit on main
      const second = await git.commit().setMessage("second").setAllowEmpty(true).call();
      const secondId = await store.commits.storeCommit(second);

      // Merge branch1 (which is behind) into main
      const result = await git.merge().include("branch1").call();

      expect(result.status).toBe(MergeStatus.ALREADY_UP_TO_DATE);
      expect(result.newHead).toBe(secondId);
    });
  });

  // ===== Fast Forward =====

  describe("fast-forward merge", () => {
    /**
     * JGit: testFastForward
     */
    it("should fast-forward when HEAD is ancestor of source", async () => {
      const { git, store, initialCommitId } = await createInitializedGit();

      // Create branch1 at initial commit
      await git.branchCreate().setName("branch1").call();

      // Add commit on main
      await git.commit().setMessage("second").setAllowEmpty(true).call();

      // Get main's HEAD for later
      const mainHead = await store.refs.resolve("refs/heads/main");

      // Switch to branch1 (simulated by updating HEAD)
      await store.refs.setSymbolic("HEAD", "refs/heads/branch1");

      // Merge main into branch1
      const result = await git.merge().include("refs/heads/main").call();

      expect(result.status).toBe(MergeStatus.FAST_FORWARD);
      expect(result.newHead).toBe(mainHead?.objectId);

      // branch1 should now point to same commit as main
      const branch1 = await store.refs.resolve("refs/heads/branch1");
      expect(branch1?.objectId).toBe(mainHead?.objectId);
    });

    it("should update staging area on fast-forward", async () => {
      const { git, store } = await createInitializedGit();

      // Create branch1 at current commit
      await git.branchCreate().setName("branch1").call();

      // Add file and commit on main
      await addFile(store, "new-file.txt", "content");
      await git.commit().setMessage("add file").call();

      // Switch to branch1
      await store.refs.setSymbolic("HEAD", "refs/heads/branch1");
      // Reset staging to branch1's tree (simulating checkout)
      const branch1Ref = await store.refs.resolve("refs/heads/branch1");
      const branch1Commit = await store.commits.loadCommit(branch1Ref?.objectId!);
      await store.staging.readTree(store.trees, branch1Commit.tree);

      // Merge main into branch1
      await git.merge().include("refs/heads/main").call();

      // Staging should now have the new file
      const entry = await store.staging.getEntry("new-file.txt");
      expect(entry).toBeDefined();
    });

    /**
     * JGit: testFastForwardOnly
     */
    it("should fail with FF_ONLY when fast-forward not possible", async () => {
      const { git, store, initialCommitId } = await createInitializedGit();

      // Create divergent branches
      await git.branchCreate().setName("branch1").call();

      // Add commit on main
      await git.commit().setMessage("main commit").setAllowEmpty(true).call();

      // Switch to branch1 and add commit there too
      await store.refs.setSymbolic("HEAD", "refs/heads/branch1");
      await git.commit().setMessage("branch commit").setAllowEmpty(true).call();

      // Try to merge main with FF_ONLY
      await expect(
        git.merge().include("refs/heads/main").setFastForwardMode(FastForwardMode.FF_ONLY).call(),
      ).rejects.toThrow(NotFastForwardError);
    });
  });

  // ===== Three-Way Merge =====

  describe("three-way merge", () => {
    /**
     * JGit: testMergeNoFastForward
     */
    it("should create merge commit with NO_FF", async () => {
      const { git, store, initialCommitId } = await createInitializedGit();

      // Create branch1 at initial commit
      await git.branchCreate().setName("branch1").call();

      // Add commit on main
      await git.commit().setMessage("main commit").setAllowEmpty(true).call();
      const _mainHead = await store.refs.resolve("refs/heads/main");

      // Switch to branch1
      await store.refs.setSymbolic("HEAD", "refs/heads/branch1");

      // Merge with NO_FF should create merge commit even though FF is possible
      const result = await git
        .merge()
        .include("refs/heads/main")
        .setFastForwardMode(FastForwardMode.NO_FF)
        .call();

      expect(result.status).toBe(MergeStatus.MERGED);

      // New HEAD should be a merge commit with 2 parents
      const newCommit = await store.commits.loadCommit(result.newHead!);
      expect(newCommit.parents.length).toBe(2);
    });

    it("should merge divergent branches without conflicts", async () => {
      const { git, store } = await createInitializedGit();

      // Create branch1
      await git.branchCreate().setName("branch1").call();

      // Add file on main and commit
      await addFile(store, "file-a.txt", "content a");
      await git.commit().setMessage("add file-a").call();

      // Switch to branch1
      await store.refs.setSymbolic("HEAD", "refs/heads/branch1");
      // Reset staging to branch1's tree
      const branch1Ref = await store.refs.resolve("refs/heads/branch1");
      const branch1Commit = await store.commits.loadCommit(branch1Ref?.objectId!);
      await store.staging.readTree(store.trees, branch1Commit.tree);

      // Add different file on branch1 and commit
      await addFile(store, "file-b.txt", "content b");
      await git.commit().setMessage("add file-b").call();

      // Merge main into branch1
      const result = await git.merge().include("refs/heads/main").call();

      expect(result.status).toBe(MergeStatus.MERGED);

      // Both files should be in staging
      const entryA = await store.staging.getEntry("file-a.txt");
      const entryB = await store.staging.getEntry("file-b.txt");
      expect(entryA).toBeDefined();
      expect(entryB).toBeDefined();
    });

    it("should use custom merge message", async () => {
      const { git, store } = await createInitializedGit();

      // Create branch1
      await git.branchCreate().setName("branch1").call();

      // Add commit on main
      await git.commit().setMessage("main commit").setAllowEmpty(true).call();

      // Switch to branch1 and add commit
      await store.refs.setSymbolic("HEAD", "refs/heads/branch1");
      await git.commit().setMessage("branch commit").setAllowEmpty(true).call();

      // Merge with custom message
      const result = await git
        .merge()
        .include("refs/heads/main")
        .setMessage("Custom merge message")
        .call();

      expect(result.status).toBe(MergeStatus.MERGED);

      const mergeCommit = await store.commits.loadCommit(result.newHead!);
      expect(mergeCommit.message).toBe("Custom merge message");
    });
  });

  // ===== Conflict Handling =====

  describe("conflict handling", () => {
    it("should detect conflicts when same file modified differently", async () => {
      const { git, store } = await createInitializedGit();

      // Add a file on initial commit
      await addFile(store, "conflict.txt", "original");
      await git.commit().setMessage("add file").call();

      // Create branch1 at current commit
      await git.branchCreate().setName("branch1").call();

      // Modify file on main
      await addFile(store, "conflict.txt", "main version");
      await git.commit().setMessage("main change").call();

      // Switch to branch1
      await store.refs.setSymbolic("HEAD", "refs/heads/branch1");
      // Reset staging to branch1's tree
      const branch1Ref = await store.refs.resolve("refs/heads/branch1");
      const branch1Commit = await store.commits.loadCommit(branch1Ref?.objectId!);
      await store.staging.readTree(store.trees, branch1Commit.tree);

      // Modify same file differently on branch1
      await addFile(store, "conflict.txt", "branch version");
      await git.commit().setMessage("branch change").call();

      // Merge main into branch1 - should conflict
      const result = await git.merge().include("refs/heads/main").call();

      expect(result.status).toBe(MergeStatus.CONFLICTING);
      expect(result.conflicts).toContain("conflict.txt");
    });

    it("should write conflict stages to staging area", async () => {
      const { git, store } = await createInitializedGit();

      // Add a file
      await addFile(store, "conflict.txt", "original");
      await git.commit().setMessage("add file").call();

      // Create branch1
      await git.branchCreate().setName("branch1").call();

      // Modify on main
      await addFile(store, "conflict.txt", "main version");
      await git.commit().setMessage("main change").call();

      // Switch to branch1 and modify
      await store.refs.setSymbolic("HEAD", "refs/heads/branch1");
      const branch1Ref = await store.refs.resolve("refs/heads/branch1");
      const branch1Commit = await store.commits.loadCommit(branch1Ref?.objectId!);
      await store.staging.readTree(store.trees, branch1Commit.tree);
      await addFile(store, "conflict.txt", "branch version");
      await git.commit().setMessage("branch change").call();

      // Merge
      await git.merge().include("refs/heads/main").call();

      // Should have conflict entries
      const hasConflicts = await store.staging.hasConflicts();
      expect(hasConflicts).toBe(true);

      // Should have multiple stages for the conflict path
      const entries = await store.staging.getEntries("conflict.txt");
      expect(entries.length).toBeGreaterThan(1);
    });
  });

  // ===== Squash Merge =====

  describe("squash merge", () => {
    it("should stage changes but not commit with squash", async () => {
      const { git, store, initialCommitId } = await createInitializedGit();

      // Create branch1 at initial commit
      await git.branchCreate().setName("branch1").call();

      // Add commits on main
      await addFile(store, "file1.txt", "content1");
      await git.commit().setMessage("add file1").call();

      // Switch to branch1
      await store.refs.setSymbolic("HEAD", "refs/heads/branch1");
      const branch1Ref = await store.refs.resolve("refs/heads/branch1");

      // Squash merge main
      const result = await git.merge().include("refs/heads/main").setSquash(true).call();

      expect(result.status).toBe(MergeStatus.MERGED_SQUASHED);

      // HEAD should still be at original position (not moved)
      const newBranch1 = await store.refs.resolve("refs/heads/branch1");
      expect(newBranch1?.objectId).toBe(branch1Ref?.objectId);

      // But staging should have the file
      const entry = await store.staging.getEntry("file1.txt");
      expect(entry).toBeDefined();
    });
  });

  // ===== No Commit Mode =====

  describe("no-commit mode", () => {
    it("should merge but not commit with setCommit(false)", async () => {
      const { git, store } = await createInitializedGit();

      // Create branch1
      await git.branchCreate().setName("branch1").call();

      // Add commit on main
      await addFile(store, "file1.txt", "content");
      await git.commit().setMessage("main commit").call();

      // Switch to branch1 and add different file
      await store.refs.setSymbolic("HEAD", "refs/heads/branch1");
      const branch1Before = await store.refs.resolve("refs/heads/branch1");
      const branch1Commit = await store.commits.loadCommit(branch1Before?.objectId!);
      await store.staging.readTree(store.trees, branch1Commit.tree);
      await addFile(store, "file2.txt", "content2");
      await git.commit().setMessage("branch commit").call();

      const branch1After = await store.refs.resolve("refs/heads/branch1");

      // Merge with no-commit
      const result = await git.merge().include("refs/heads/main").setCommit(false).call();

      expect(result.status).toBe(MergeStatus.MERGED_NOT_COMMITTED);

      // HEAD should be unchanged
      const branch1Final = await store.refs.resolve("refs/heads/branch1");
      expect(branch1Final?.objectId).toBe(branch1After?.objectId);

      // But staging should have merged content
      const entry1 = await store.staging.getEntry("file1.txt");
      const entry2 = await store.staging.getEntry("file2.txt");
      expect(entry1).toBeDefined();
      expect(entry2).toBeDefined();
    });
  });

  // ===== Error Cases =====

  describe("error handling", () => {
    it("should throw when no merge head specified", async () => {
      const { git } = await createInitializedGit();

      await expect(git.merge().call()).rejects.toThrow(InvalidMergeHeadsError);
    });

    it("should throw when multiple merge heads specified", async () => {
      const { git } = await createInitializedGit();

      await expect(git.merge().include("branch1").include("branch2").call()).rejects.toThrow(
        InvalidMergeHeadsError,
      );
    });

    it("should not be callable twice", async () => {
      const { git, initialCommitId } = await createInitializedGit();

      const cmd = git.merge().include("HEAD");
      await cmd.call();

      await expect(cmd.call()).rejects.toThrow(/already been called/);
    });
  });

  // ===== Branch Resolution =====

  describe("branch resolution", () => {
    it("should resolve branch name to commit", async () => {
      const { git, store, initialCommitId } = await createInitializedGit();

      // Create and checkout feature branch
      await git.branchCreate().setName("feature").call();
      await store.refs.setSymbolic("HEAD", "refs/heads/feature");

      // Add commit on feature
      await git.commit().setMessage("feature commit").setAllowEmpty(true).call();
      const featureRef = await store.refs.resolve("refs/heads/feature");

      // Switch back to main
      await store.refs.setSymbolic("HEAD", "refs/heads/main");

      // Merge using branch name
      const result = await git.merge().include("feature").call();

      expect(result.status).toBe(MergeStatus.FAST_FORWARD);
      expect(result.newHead).toBe(featureRef?.objectId);
    });

    it("should resolve commit ID directly", async () => {
      const { git, store, initialCommitId } = await createInitializedGit();

      // Create branch and add commit
      await git.branchCreate().setName("feature").call();
      await store.refs.setSymbolic("HEAD", "refs/heads/feature");
      await git.commit().setMessage("feature commit").setAllowEmpty(true).call();
      const featureRef = await store.refs.resolve("refs/heads/feature");

      // Switch to main
      await store.refs.setSymbolic("HEAD", "refs/heads/main");

      // Merge using commit ID
      const result = await git.merge().include(featureRef?.objectId!).call();

      expect(result.status).toBe(MergeStatus.FAST_FORWARD);
    });
  });
});

describe("MergeCommand with log verification", () => {
  it("should show merge commit in log with correct parents", async () => {
    const { git, store } = await createInitializedGit();

    // Create divergent branches
    await git.branchCreate().setName("feature").call();

    await git.commit().setMessage("main commit").setAllowEmpty(true).call();
    const mainHead = await store.refs.resolve("refs/heads/main");

    await store.refs.setSymbolic("HEAD", "refs/heads/feature");
    await git.commit().setMessage("feature commit").setAllowEmpty(true).call();
    const featureHead = await store.refs.resolve("refs/heads/feature");

    // Merge main into feature
    const result = await git.merge().include("refs/heads/main").call();

    expect(result.status).toBe(MergeStatus.MERGED);

    // Log should show merge commit
    const commits = await toArray(await git.log().call());
    expect(commits.length).toBe(4); // merge + feature + main + initial

    // First commit should be the merge
    const mergeCommit = commits[0];
    expect(mergeCommit.parents.length).toBe(2);
    expect(mergeCommit.parents).toContain(featureHead?.objectId);
    expect(mergeCommit.parents).toContain(mainHead?.objectId);
  });
});
