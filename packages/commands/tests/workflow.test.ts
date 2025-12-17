/**
 * Integration tests for Phase 1 workflow
 *
 * Verifies the complete workflow: commit → log → branch → reset
 */

import { describe, expect, it } from "vitest";

import { ListBranchMode, ResetMode } from "../src/index.js";
import { createInitializedGit, toArray } from "./test-helper.js";

describe("Phase 1 Integration Workflow", () => {
  it("should support complete workflow: commit → log → branch → reset", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // === STEP 1: Create commits ===
    const commit1 = await git
      .commit()
      .setMessage("Feature: Add user authentication")
      .setAuthor("Alice", "alice@example.com")
      .setAllowEmpty(true)
      .call();

    const commit2 = await git
      .commit()
      .setMessage("Fix: Authentication bug")
      .setAuthor("Bob", "bob@example.com")
      .setAllowEmpty(true)
      .call();

    // === STEP 2: Verify log shows commits ===
    let commits = await toArray(await git.log().call());
    expect(commits.length).toBe(3); // Initial + 2 new commits
    expect(commits[0].message).toBe("Fix: Authentication bug");
    expect(commits[1].message).toBe("Feature: Add user authentication");
    expect(commits[2].message).toBe("Initial commit");

    // === STEP 3: Create branches ===
    const featureBranch = await git
      .branchCreate()
      .setName("feature/new-api")
      .call();

    expect(featureBranch.name).toBe("refs/heads/feature/new-api");

    // List branches
    const branches = await git.branchList().call();
    const branchNames = branches.map((b) => b.name);
    expect(branchNames).toContain("refs/heads/main");
    expect(branchNames).toContain("refs/heads/feature/new-api");

    // === STEP 4: Create tag ===
    const tag = await git
      .tag()
      .setName("v1.0.0")
      .setMessage("First stable release")
      .call();

    expect(tag.name).toBe("refs/tags/v1.0.0");

    // List tags
    const tags = await git.tagList().call();
    expect(tags.length).toBe(1);
    expect(tags[0].name).toBe("refs/tags/v1.0.0");

    // === STEP 5: Soft reset ===
    // Remember current HEAD
    const headBefore = await store.refs.resolve("HEAD");

    // Soft reset to previous commit
    await git.reset().setRef("HEAD~1").setMode(ResetMode.SOFT).call();

    // Verify HEAD moved
    const headAfter = await store.refs.resolve("HEAD");
    expect(headAfter?.objectId).not.toBe(headBefore?.objectId);

    // Log should now show 2 commits
    commits = await toArray(await git.log().call());
    expect(commits.length).toBe(2);
    expect(commits[0].message).toBe("Feature: Add user authentication");

    // === STEP 6: Reset back to original ===
    // Reset to the tag (which still points to commit2)
    await git.reset().setRef("v1.0.0").call();

    // Log should show all 3 commits again
    commits = await toArray(await git.log().call());
    expect(commits.length).toBe(3);
  });

  it("should support branch switching simulation", async () => {
    const { git, store, initialCommitId } = await createInitializedGit();

    // Create commits on main
    await git
      .commit()
      .setMessage("Main commit 1")
      .setAllowEmpty(true)
      .call();

    const mainCommit2 = await git
      .commit()
      .setMessage("Main commit 2")
      .setAllowEmpty(true)
      .call();

    const mainCommit2Id = await store.commits.storeCommit(mainCommit2);

    // Create feature branch from commit 1
    await git
      .branchCreate()
      .setName("feature")
      .setStartPoint("HEAD~1")
      .call();

    // Simulate checkout to feature branch
    await store.refs.setSymbolic("HEAD", "refs/heads/feature");

    // Create commit on feature branch
    await git
      .commit()
      .setMessage("Feature commit")
      .setAllowEmpty(true)
      .call();

    // Log on feature branch
    let commits = await toArray(await git.log().call());
    expect(commits.length).toBe(3);
    expect(commits[0].message).toBe("Feature commit");
    expect(commits[1].message).toBe("Main commit 1");

    // Switch back to main
    await store.refs.setSymbolic("HEAD", "refs/heads/main");

    // Log on main
    commits = await toArray(await git.log().call());
    expect(commits.length).toBe(3);
    expect(commits[0].message).toBe("Main commit 2");
  });

  it("should support tag workflow", async () => {
    const { git, store } = await createInitializedGit();

    // Create release commits
    await git
      .commit()
      .setMessage("Release 1.0.0")
      .setAllowEmpty(true)
      .call();

    const release1 = await store.refs.resolve("HEAD");

    await git.tag().setName("v1.0.0").call();

    await git
      .commit()
      .setMessage("Release 1.0.1 - bugfix")
      .setAllowEmpty(true)
      .call();

    await git.tag().setName("v1.0.1").call();

    await git
      .commit()
      .setMessage("Release 1.1.0 - new features")
      .setAllowEmpty(true)
      .call();

    await git
      .tag()
      .setName("v1.1.0")
      .setMessage("Major feature release")
      .setTagger("Release Manager", "release@example.com")
      .call();

    // List all tags
    const tags = await git.tagList().call();
    expect(tags.length).toBe(3);

    const tagNames = tags.map((t) => t.name);
    expect(tagNames).toEqual([
      "refs/tags/v1.0.0",
      "refs/tags/v1.0.1",
      "refs/tags/v1.1.0",
    ]);

    // Reset to v1.0.0
    await git.reset().setRef("v1.0.0").call();

    // Log should show only commits up to v1.0.0
    const commits = await toArray(await git.log().call());
    expect(commits.length).toBe(2); // Initial + Release 1.0.0
    expect(commits[0].message).toBe("Release 1.0.0");
  });

  it("should support branch cleanup", async () => {
    const { git, store } = await createInitializedGit();

    // Create commit
    await git
      .commit()
      .setMessage("Base commit")
      .setAllowEmpty(true)
      .call();

    // Create multiple feature branches
    await git.branchCreate().setName("feature-1").call();
    await git.branchCreate().setName("feature-2").call();
    await git.branchCreate().setName("feature-3").call();

    // List branches
    let branches = await git.branchList().call();
    expect(branches.length).toBe(4); // main + 3 features

    // Delete feature branches (they're merged since same commit)
    await git.branchDelete().setBranchNames("feature-1", "feature-2").call();

    // List remaining branches
    branches = await git.branchList().call();
    expect(branches.length).toBe(2); // main + feature-3

    // Rename remaining feature branch
    await git
      .branchRename()
      .setOldName("feature-3")
      .setNewName("develop")
      .call();

    branches = await git.branchList().call();
    const branchNames = branches.map((b) => b.name);
    expect(branchNames).toContain("refs/heads/main");
    expect(branchNames).toContain("refs/heads/develop");
    expect(branchNames).not.toContain("refs/heads/feature-3");
  });

  it("should support log filtering by count", async () => {
    const { git } = await createInitializedGit();

    // Create 10 commits
    for (let i = 1; i <= 10; i++) {
      await git
        .commit()
        .setMessage(`Commit ${i}`)
        .setAllowEmpty(true)
        .call();
    }

    // Get all commits
    let commits = await toArray(await git.log().call());
    expect(commits.length).toBe(11); // Initial + 10

    // Get last 5
    commits = await toArray(await git.log().setMaxCount(5).call());
    expect(commits.length).toBe(5);
    expect(commits[0].message).toBe("Commit 10");
    expect(commits[4].message).toBe("Commit 6");

    // Skip 3, get next 3
    commits = await toArray(await git.log().setSkip(3).setMaxCount(3).call());
    expect(commits.length).toBe(3);
    expect(commits[0].message).toBe("Commit 7");
    expect(commits[2].message).toBe("Commit 5");
  });
});
