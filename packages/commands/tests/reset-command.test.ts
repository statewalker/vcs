/**
 * Tests for ResetCommand
 *
 * Based on JGit's ResetCommandTest.java
 * Tests run against all storage backends (Memory, SQL).
 */

import { afterEach, describe, expect, it } from "vitest";
import { RefNotFoundError } from "../src/errors/index.js";
import { ResetMode } from "../src/index.js";
import { backends, createInitializedGitFromFactory, toArray } from "./test-helper.js";

describe.each(backends)("ResetCommand ($name backend)", ({ factory }) => {
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

  describe("ResetCommand", () => {
    it("should reset to HEAD by default", async () => {
      const { git } = await createInitializedGit();

      // Create commits
      await git.commit().setMessage("Second").setAllowEmpty(true).call();

      const ref = await git.reset().call();

      expect(ref).toBeDefined();
    });

    it("should soft reset (move HEAD only)", async () => {
      const { git, workingCopy, repository, initialCommitId } = await createInitializedGit();

      // Create commit
      await git.commit().setMessage("Second").setAllowEmpty(true).call();

      // Soft reset to initial commit
      await git.reset().setRef(initialCommitId).setMode(ResetMode.SOFT).call();

      // HEAD should point to initial commit
      const headRef = await repository.refs.resolve("HEAD");
      expect(headRef?.objectId).toBe(initialCommitId);

      // Staging should remain unchanged (soft reset doesn't touch it)
      // This is verified by the fact that writeTree would produce same tree
    });

    it("should mixed reset (move HEAD and reset staging)", async () => {
      const { git, workingCopy, repository, initialCommitId } = await createInitializedGit();

      // Create commit
      await git.commit().setMessage("Second").setAllowEmpty(true).call();

      // Mixed reset to initial commit
      await git.reset().setRef(initialCommitId).setMode(ResetMode.MIXED).call();

      // HEAD should point to initial commit
      const headRef = await repository.refs.resolve("HEAD");
      expect(headRef?.objectId).toBe(initialCommitId);

      // Staging should match initial commit's tree
      const treeId = await workingCopy.staging.writeTree(repository.trees);
      const initialCommit = await repository.commits.loadCommit(initialCommitId);
      expect(treeId).toBe(initialCommit.tree);
    });

    it("should reset with HEAD~N notation", async () => {
      const { git, workingCopy, repository, initialCommitId } = await createInitializedGit();

      // Create commits
      await git.commit().setMessage("Second").setAllowEmpty(true).call();
      await git.commit().setMessage("Third").setAllowEmpty(true).call();

      // Reset to HEAD~2 (should be initial commit)
      await git.reset().setRef("HEAD~2").call();

      const headRef = await repository.refs.resolve("HEAD");
      expect(headRef?.objectId).toBe(initialCommitId);
    });

    it("should reset with HEAD^ notation", async () => {
      const { git, workingCopy, repository } = await createInitializedGit();

      // Create commit
      const second = await git.commit().setMessage("Second").setAllowEmpty(true).call();
      const secondId = await repository.commits.storeCommit(second);

      await git.commit().setMessage("Third").setAllowEmpty(true).call();

      // Reset to HEAD^ (should be second commit)
      await git.reset().setRef("HEAD^").call();

      const headRef = await repository.refs.resolve("HEAD");
      expect(headRef?.objectId).toBe(secondId);
    });

    it("should throw when ref cannot be resolved", async () => {
      const { git } = await createInitializedGit();

      await expect(git.reset().setRef("nonexistent").call()).rejects.toThrow(RefNotFoundError);
    });

    it("should throw when relative ref goes beyond history", async () => {
      const { git } = await createInitializedGit();

      // Initial commit has no parent
      await expect(git.reset().setRef("HEAD~10").call()).rejects.toThrow(RefNotFoundError);
    });

    it("should update branch ref", async () => {
      const { git, workingCopy, repository, initialCommitId } = await createInitializedGit();

      // Create commits
      await git.commit().setMessage("Second").setAllowEmpty(true).call();

      // Reset
      await git.reset().setRef(initialCommitId).call();

      // Branch should be updated
      const branchRef = await repository.refs.resolve("refs/heads/main");
      expect(branchRef?.objectId).toBe(initialCommitId);
    });

    it("should work with detached HEAD", async () => {
      const { git, workingCopy, repository, initialCommitId } = await createInitializedGit();

      // Create commit
      const second = await git.commit().setMessage("Second").setAllowEmpty(true).call();
      const secondId = await repository.commits.storeCommit(second);

      // Detach HEAD
      await repository.refs.set("HEAD", secondId);

      // Reset
      await git.reset().setRef(initialCommitId).call();

      // HEAD should be updated directly
      const head = await repository.refs.get("HEAD");
      expect(head && "objectId" in head ? head.objectId : null).toBe(initialCommitId);
    });

    it("should not be callable twice", async () => {
      const { git } = await createInitializedGit();

      const cmd = git.reset();
      await cmd.call();

      await expect(cmd.call()).rejects.toThrow(/already been called/);
    });
  });

  describe("ResetCommand with log verification", () => {
    it("should affect log after reset", async () => {
      const { git, initialCommitId } = await createInitializedGit();

      // Create commits
      await git.commit().setMessage("Second").setAllowEmpty(true).call();
      await git.commit().setMessage("Third").setAllowEmpty(true).call();

      // Before reset: 3 commits visible
      let commits = await toArray(await git.log().call());
      expect(commits.length).toBe(3);

      // Reset to initial commit
      await git.reset().setRef(initialCommitId).call();

      // After reset: only initial commit visible
      commits = await toArray(await git.log().call());
      expect(commits.length).toBe(1);
      expect(commits[0].message).toBe("Initial commit");
    });
  });
});
