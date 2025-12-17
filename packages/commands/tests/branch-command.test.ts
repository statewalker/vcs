/**
 * Tests for BranchCommand (create, delete, list, rename)
 *
 * Based on JGit's BranchCommandTest.java and RenameBranchCommandTest.java
 */

import { describe, expect, it } from "vitest";
import {
  CannotDeleteCurrentBranchError,
  InvalidRefNameError,
  NotMergedError,
  RefAlreadyExistsError,
  RefNotFoundError,
} from "../src/errors/index.js";
import { ListBranchMode } from "../src/index.js";
import { createInitializedGit } from "./test-helper.js";

describe("CreateBranchCommand", () => {
  it("should create branch at HEAD", async () => {
    const { git, store } = await createInitializedGit();

    const ref = await git.branchCreate().setName("feature").call();

    expect(ref.name).toBe("refs/heads/feature");
    expect(await store.refs.has("refs/heads/feature")).toBe(true);
  });

  it("should create branch at specific commit", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Create some commits
    await git.commit().setMessage("Second").setAllowEmpty(true).call();

    // Create branch at initial commit
    const ref = await git.branchCreate().setName("feature").setStartPoint(initialCommitId).call();

    expect(ref.objectId).toBe(initialCommitId);
  });

  it("should reject invalid branch names", async () => {
    const { git } = await createInitializedGit();

    await expect(git.branchCreate().setName("feature..branch").call()).rejects.toThrow(
      InvalidRefNameError,
    );

    await expect(git.branchCreate().setName("-feature").call()).rejects.toThrow(
      InvalidRefNameError,
    );

    await expect(git.branchCreate().setName("feature.lock").call()).rejects.toThrow(
      InvalidRefNameError,
    );
  });

  it("should reject duplicate branch names without force", async () => {
    const { git } = await createInitializedGit();

    await git.branchCreate().setName("feature").call();

    await expect(git.branchCreate().setName("feature").call()).rejects.toThrow(
      RefAlreadyExistsError,
    );
  });

  it("should overwrite branch with force", async () => {
    const { git, store } = await createInitializedGit();

    // Create branch
    await git.branchCreate().setName("feature").call();

    // Create a commit
    const commit = await git.commit().setMessage("New").setAllowEmpty(true).call();
    const _commitId = await store.commits.storeCommit(commit);

    // Force create at new commit
    const ref = await git.branchCreate().setName("feature").setForce(true).call();

    // Branch should point to latest commit on main (HEAD)
    const headRef = await store.refs.resolve("HEAD");
    expect(ref.objectId).toBe(headRef?.objectId);
  });

  it("should require branch name", async () => {
    const { git } = await createInitializedGit();

    await expect(git.branchCreate().call()).rejects.toThrow(InvalidRefNameError);
  });
});

describe("DeleteBranchCommand", () => {
  it("should delete branch", async () => {
    const { git, store } = await createInitializedGit();

    await git.branchCreate().setName("feature").call();
    expect(await store.refs.has("refs/heads/feature")).toBe(true);

    const deleted = await git.branchDelete().setBranchNames("feature").call();

    expect(deleted).toEqual(["refs/heads/feature"]);
    expect(await store.refs.has("refs/heads/feature")).toBe(false);
  });

  it("should delete multiple branches", async () => {
    const { git, store } = await createInitializedGit();

    await git.branchCreate().setName("feature1").call();
    await git.branchCreate().setName("feature2").call();

    const deleted = await git.branchDelete().setBranchNames("feature1", "feature2").call();

    expect(deleted.length).toBe(2);
    expect(await store.refs.has("refs/heads/feature1")).toBe(false);
    expect(await store.refs.has("refs/heads/feature2")).toBe(false);
  });

  it("should not delete current branch", async () => {
    const { git } = await createInitializedGit();

    await expect(git.branchDelete().setBranchNames("main").call()).rejects.toThrow(
      CannotDeleteCurrentBranchError,
    );
  });

  it("should reject deleting non-existent branch", async () => {
    const { git } = await createInitializedGit();

    await expect(git.branchDelete().setBranchNames("nonexistent").call()).rejects.toThrow(
      RefNotFoundError,
    );
  });

  it("should reject deleting unmerged branch without force", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Create branch at initial commit
    await git.branchCreate().setName("feature").setStartPoint(initialCommitId).call();

    // Add commit to feature branch (simulated by setting ref directly)
    const commit = {
      tree: (await store.commits.loadCommit(initialCommitId)).tree,
      parents: [initialCommitId],
      author: { name: "Test", email: "test@example.com", timestamp: Date.now(), tzOffset: "+0000" },
      committer: {
        name: "Test",
        email: "test@example.com",
        timestamp: Date.now(),
        tzOffset: "+0000",
      },
      message: "Feature commit",
    };
    const featureCommitId = await store.commits.storeCommit(commit);
    await store.refs.set("refs/heads/feature", featureCommitId);

    // Now feature is ahead of main - should fail to delete
    await expect(git.branchDelete().setBranchNames("feature").call()).rejects.toThrow(
      NotMergedError,
    );
  });

  it("should force delete unmerged branch", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Create branch with unique commit
    await git.branchCreate().setName("feature").setStartPoint(initialCommitId).call();

    const commit = {
      tree: (await store.commits.loadCommit(initialCommitId)).tree,
      parents: [initialCommitId],
      author: { name: "Test", email: "test@example.com", timestamp: Date.now(), tzOffset: "+0000" },
      committer: {
        name: "Test",
        email: "test@example.com",
        timestamp: Date.now(),
        tzOffset: "+0000",
      },
      message: "Feature commit",
    };
    const featureCommitId = await store.commits.storeCommit(commit);
    await store.refs.set("refs/heads/feature", featureCommitId);

    // Force delete should work
    const deleted = await git.branchDelete().setBranchNames("feature").setForce(true).call();

    expect(deleted).toEqual(["refs/heads/feature"]);
  });
});

describe("ListBranchCommand", () => {
  it("should list local branches", async () => {
    const { git } = await createInitializedGit();

    await git.branchCreate().setName("feature1").call();
    await git.branchCreate().setName("feature2").call();

    const branches = await git.branchList().call();

    const names = branches.map((b) => b.name);
    expect(names).toContain("refs/heads/main");
    expect(names).toContain("refs/heads/feature1");
    expect(names).toContain("refs/heads/feature2");
  });

  it("should return branches in sorted order", async () => {
    const { git } = await createInitializedGit();

    await git.branchCreate().setName("zebra").call();
    await git.branchCreate().setName("alpha").call();

    const branches = await git.branchList().call();
    const names = branches.map((b) => b.name);

    // Should be sorted
    expect(names.indexOf("refs/heads/alpha")).toBeLessThan(names.indexOf("refs/heads/main"));
    expect(names.indexOf("refs/heads/main")).toBeLessThan(names.indexOf("refs/heads/zebra"));
  });

  it("should list remote branches when mode is REMOTE", async () => {
    const { git, store } = await createInitializedGit();

    // Simulate remote tracking branch
    const headRef = await store.refs.resolve("HEAD");
    await store.refs.set("refs/remotes/origin/main", headRef?.objectId!);

    const branches = await git.branchList().setListMode(ListBranchMode.REMOTE).call();

    const names = branches.map((b) => b.name);
    expect(names).toContain("refs/remotes/origin/main");
    expect(names).not.toContain("refs/heads/main");
  });

  it("should list all branches when mode is ALL", async () => {
    const { git, store } = await createInitializedGit();

    await git.branchCreate().setName("feature").call();

    const headRef = await store.refs.resolve("HEAD");
    await store.refs.set("refs/remotes/origin/main", headRef?.objectId!);

    const branches = await git.branchList().setListMode(ListBranchMode.ALL).call();

    const names = branches.map((b) => b.name);
    expect(names).toContain("refs/heads/main");
    expect(names).toContain("refs/heads/feature");
    expect(names).toContain("refs/remotes/origin/main");
  });
});

describe("RenameBranchCommand", () => {
  it("should rename branch", async () => {
    const { git, store } = await createInitializedGit();

    await git.branchCreate().setName("old-name").call();

    const ref = await git.branchRename().setOldName("old-name").setNewName("new-name").call();

    expect(ref.name).toBe("refs/heads/new-name");
    expect(await store.refs.has("refs/heads/old-name")).toBe(false);
    expect(await store.refs.has("refs/heads/new-name")).toBe(true);
  });

  it("should rename current branch when oldName not specified", async () => {
    const { git, store } = await createInitializedGit();

    const ref = await git.branchRename().setNewName("renamed-main").call();

    expect(ref.name).toBe("refs/heads/renamed-main");
    expect(await store.refs.has("refs/heads/main")).toBe(false);

    // HEAD should now point to renamed branch
    const head = await store.refs.get("HEAD");
    expect(head && "target" in head ? head.target : null).toBe("refs/heads/renamed-main");
  });

  it("should reject invalid new name", async () => {
    const { git } = await createInitializedGit();

    await git.branchCreate().setName("feature").call();

    await expect(
      git.branchRename().setOldName("feature").setNewName("invalid..name").call(),
    ).rejects.toThrow(InvalidRefNameError);
  });

  it("should reject if new name already exists", async () => {
    const { git } = await createInitializedGit();

    await git.branchCreate().setName("feature1").call();
    await git.branchCreate().setName("feature2").call();

    await expect(
      git.branchRename().setOldName("feature1").setNewName("feature2").call(),
    ).rejects.toThrow(RefAlreadyExistsError);
  });

  it("should reject if old branch doesn't exist", async () => {
    const { git } = await createInitializedGit();

    await expect(
      git.branchRename().setOldName("nonexistent").setNewName("new-name").call(),
    ).rejects.toThrow(RefNotFoundError);
  });
});
