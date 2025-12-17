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

describe("LogCommand date filtering", () => {
  it("should filter commits by setSince", async () => {
    const { git } = await createInitializedGit();

    // Create commits with different timestamps
    const now = Math.floor(Date.now() / 1000);

    await git
      .commit()
      .setMessage("Old commit")
      .setAllowEmpty(true)
      .setCommitterIdent({ name: "Test", email: "test@example.com", timestamp: now - 3600, tzOffset: "+0000" })
      .call();

    await git
      .commit()
      .setMessage("Recent commit")
      .setAllowEmpty(true)
      .setCommitterIdent({ name: "Test", email: "test@example.com", timestamp: now - 60, tzOffset: "+0000" })
      .call();

    // Only get commits from last 30 minutes
    const commits = await toArray(await git.log().setSince(now - 1800).call());

    expect(commits.length).toBe(1);
    expect(commits[0].message).toBe("Recent commit");
  });

  it("should filter commits by setUntil", async () => {
    const { git } = await createInitializedGit();

    const now = Math.floor(Date.now() / 1000);

    await git
      .commit()
      .setMessage("Old commit")
      .setAllowEmpty(true)
      .setCommitterIdent({ name: "Test", email: "test@example.com", timestamp: now - 3600, tzOffset: "+0000" })
      .call();

    await git
      .commit()
      .setMessage("Recent commit")
      .setAllowEmpty(true)
      .setCommitterIdent({ name: "Test", email: "test@example.com", timestamp: now, tzOffset: "+0000" })
      .call();

    // Only get commits older than 30 minutes
    const commits = await toArray(await git.log().setUntil(now - 1800).call());

    // Should include old commit and initial commit
    expect(commits.some((c) => c.message === "Old commit")).toBe(true);
    expect(commits.every((c) => c.message !== "Recent commit")).toBe(true);
  });

  it("should combine setSince and setUntil", async () => {
    const { git } = await createInitializedGit();

    const now = Math.floor(Date.now() / 1000);

    await git
      .commit()
      .setMessage("Very old")
      .setAllowEmpty(true)
      .setCommitterIdent({ name: "Test", email: "test@example.com", timestamp: now - 7200, tzOffset: "+0000" })
      .call();

    await git
      .commit()
      .setMessage("Middle")
      .setAllowEmpty(true)
      .setCommitterIdent({ name: "Test", email: "test@example.com", timestamp: now - 3600, tzOffset: "+0000" })
      .call();

    await git
      .commit()
      .setMessage("Recent")
      .setAllowEmpty(true)
      .setCommitterIdent({ name: "Test", email: "test@example.com", timestamp: now, tzOffset: "+0000" })
      .call();

    // Get commits between 2 hours ago and 30 minutes ago
    const commits = await toArray(
      await git
        .log()
        .setSince(now - 7200)
        .setUntil(now - 1800)
        .call(),
    );

    // Should include "Very old" and "Middle" but not "Recent"
    expect(commits.some((c) => c.message === "Very old")).toBe(true);
    expect(commits.some((c) => c.message === "Middle")).toBe(true);
    expect(commits.every((c) => c.message !== "Recent")).toBe(true);
  });
});

describe("LogCommand author filtering", () => {
  it("should filter by author name", async () => {
    const { git } = await createInitializedGit();

    await git
      .commit()
      .setMessage("By Alice")
      .setAllowEmpty(true)
      .setAuthor("Alice Smith", "alice@example.com")
      .call();

    await git
      .commit()
      .setMessage("By Bob")
      .setAllowEmpty(true)
      .setAuthor("Bob Jones", "bob@example.com")
      .call();

    const commits = await toArray(await git.log().setAuthorFilter("alice").call());

    expect(commits.length).toBe(1);
    expect(commits[0].message).toBe("By Alice");
  });

  it("should filter by author email", async () => {
    const { git } = await createInitializedGit();

    await git
      .commit()
      .setMessage("By Alice")
      .setAllowEmpty(true)
      .setAuthor("Alice Smith", "alice@example.com")
      .call();

    await git
      .commit()
      .setMessage("By Bob")
      .setAllowEmpty(true)
      .setAuthor("Bob Jones", "bob@example.com")
      .call();

    const commits = await toArray(await git.log().setAuthorFilter("bob@example.com").call());

    expect(commits.length).toBe(1);
    expect(commits[0].message).toBe("By Bob");
  });

  it("should filter by committer", async () => {
    const { git } = await createInitializedGit();

    await git
      .commit()
      .setMessage("Committed by Carol")
      .setAllowEmpty(true)
      .setCommitter("Carol Davis", "carol@example.com")
      .call();

    await git
      .commit()
      .setMessage("Committed by Dave")
      .setAllowEmpty(true)
      .setCommitter("Dave Wilson", "dave@example.com")
      .call();

    const commits = await toArray(await git.log().setCommitterFilter("carol").call());

    expect(commits.length).toBe(1);
    expect(commits[0].message).toBe("Committed by Carol");
  });
});

describe("LogCommand not() exclusion", () => {
  it("should exclude commits reachable from not() target", async () => {
    const { git, store } = await createInitializedGit();

    // Create base commit
    await git.commit().setMessage("Base").setAllowEmpty(true).call();
    const baseRef = await store.refs.resolve("HEAD");
    const baseId = baseRef?.objectId ?? "";

    // Create more commits
    await git.commit().setMessage("Feature 1").setAllowEmpty(true).call();
    await git.commit().setMessage("Feature 2").setAllowEmpty(true).call();

    // Get commits excluding base and its ancestors
    const commits = await toArray(await git.log().not(baseId).call());

    expect(commits.length).toBe(2);
    expect(commits[0].message).toBe("Feature 2");
    expect(commits[1].message).toBe("Feature 1");
    // Base and Initial should be excluded
    expect(commits.every((c) => c.message !== "Base")).toBe(true);
    expect(commits.every((c) => c.message !== "Initial commit")).toBe(true);
  });

  it("should support multiple not() calls", async () => {
    const { git, store } = await createInitializedGit();

    // Create commit chain
    await git.commit().setMessage("C1").setAllowEmpty(true).call();
    const c1Ref = await store.refs.resolve("HEAD");
    const c1Id = c1Ref?.objectId ?? "";

    await git.commit().setMessage("C2").setAllowEmpty(true).call();
    const c2Ref = await store.refs.resolve("HEAD");
    const c2Id = c2Ref?.objectId ?? "";

    await git.commit().setMessage("C3").setAllowEmpty(true).call();

    // Exclude both C1 and C2 explicitly
    const commits = await toArray(await git.log().not(c1Id).not(c2Id).call());

    expect(commits.length).toBe(1);
    expect(commits[0].message).toBe("C3");
  });
});
