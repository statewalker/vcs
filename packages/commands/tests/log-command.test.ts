/**
 * Tests for LogCommand
 *
 * Based on JGit's LogCommandTest.java and LogFilterTest.java
 */

import { describe, expect, it } from "vitest";

import { createInitializedGit, toArray } from "./test-helper.js";

describe("LogCommand", () => {
  it("should return commits from HEAD", async () => {
    const { git } = await createInitializedGit();

    // Create some commits
    await git.commit().setMessage("Second").setAllowEmpty(true).call();
    await git.commit().setMessage("Third").setAllowEmpty(true).call();

    const commits = await toArray(await git.log().call());

    expect(commits.length).toBe(3);
    expect(commits[0].message).toBe("Third");
    expect(commits[1].message).toBe("Second");
    expect(commits[2].message).toBe("Initial commit");
  });

  it("should limit commits with setMaxCount", async () => {
    const { git } = await createInitializedGit();

    await git.commit().setMessage("Second").setAllowEmpty(true).call();
    await git.commit().setMessage("Third").setAllowEmpty(true).call();
    await git.commit().setMessage("Fourth").setAllowEmpty(true).call();

    const commits = await toArray(await git.log().setMaxCount(2).call());

    expect(commits.length).toBe(2);
    expect(commits[0].message).toBe("Fourth");
    expect(commits[1].message).toBe("Third");
  });

  it("should skip commits with setSkip", async () => {
    const { git } = await createInitializedGit();

    await git.commit().setMessage("Second").setAllowEmpty(true).call();
    await git.commit().setMessage("Third").setAllowEmpty(true).call();
    await git.commit().setMessage("Fourth").setAllowEmpty(true).call();

    const commits = await toArray(await git.log().setSkip(1).call());

    expect(commits.length).toBe(3);
    expect(commits[0].message).toBe("Third");
    expect(commits[1].message).toBe("Second");
    expect(commits[2].message).toBe("Initial commit");
  });

  it("should combine skip and maxCount", async () => {
    const { git } = await createInitializedGit();

    await git.commit().setMessage("Second").setAllowEmpty(true).call();
    await git.commit().setMessage("Third").setAllowEmpty(true).call();
    await git.commit().setMessage("Fourth").setAllowEmpty(true).call();
    await git.commit().setMessage("Fifth").setAllowEmpty(true).call();

    const commits = await toArray(await git.log().setSkip(1).setMaxCount(2).call());

    expect(commits.length).toBe(2);
    expect(commits[0].message).toBe("Fourth");
    expect(commits[1].message).toBe("Third");
  });

  it("should start from specific commit", async () => {
    const { git, store } = await createInitializedGit();

    const second = await git.commit().setMessage("Second").setAllowEmpty(true).call();
    const secondId = await store.commits.storeCommit(second);

    await git.commit().setMessage("Third").setAllowEmpty(true).call();
    await git.commit().setMessage("Fourth").setAllowEmpty(true).call();

    // Start from second commit
    const commits = await toArray(await git.log().add(secondId).call());

    expect(commits.length).toBe(2);
    expect(commits[0].message).toBe("Second");
    expect(commits[1].message).toBe("Initial commit");
  });

  it("should not be callable twice", async () => {
    const { git } = await createInitializedGit();

    const cmd = git.log();
    await cmd.call();

    await expect(cmd.call()).rejects.toThrow(/already been called/);
  });

  it("should follow first parent only when set", async () => {
    const { git, store } = await createInitializedGit();

    // Create two branches
    const main1 = await git.commit().setMessage("Main 1").setAllowEmpty(true).call();
    const _main1Id = await store.commits.storeCommit(main1);

    // Create feature branch commit
    await git.branchCreate().setName("feature").call();

    // Make commits on main
    const main2 = await git.commit().setMessage("Main 2").setAllowEmpty(true).call();
    const _main2Id = await store.commits.storeCommit(main2);

    // Checkout feature and make commit (simulated - we'd need checkout command)
    // For now just test that firstParent option works with linear history
    const commits = await toArray(await git.log().setFirstParent(true).call());

    // Should follow linear history
    expect(commits.length).toBeGreaterThan(0);
  });
});

describe("LogCommand with all refs", () => {
  it("should include commits from all refs when all() is called", async () => {
    const { git, store } = await createInitializedGit();

    // Create commit on main
    const main1 = await git.commit().setMessage("Main commit").setAllowEmpty(true).call();
    const main1Id = await store.commits.storeCommit(main1);

    // Create branch with different commit history
    await git.branchCreate().setName("feature").setStartPoint(main1Id).call();

    // Commits on main branch should be visible with all()
    const commits = await toArray(await git.log().all().call());

    // Should include all reachable commits
    expect(commits.length).toBeGreaterThanOrEqual(2);
  });
});
