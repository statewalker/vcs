/**
 * Tests for Stash commands (StashCreateCommand, StashApplyCommand, StashDropCommand, StashListCommand)
 *
 * Ported from JGit's Stash*CommandTest.java files
 */

import { describe, expect, it } from "vitest";

import { ContentMergeStrategy, MergeStrategy, StashApplyStatus } from "../src/index.js";
import { addFile, createInitializedGit } from "./test-helper.js";

describe("StashListCommand", () => {
  /**
   * Test listing stashes when none exist.
   */
  it("should return empty list when no stashes", async () => {
    const { git, store } = await createInitializedGit();

    // Create a commit so we have a valid HEAD
    await addFile(store, "file.txt", "content");
    await git.commit().setMessage("initial").call();

    const stashes = await git.stashList().call();

    expect(stashes).toEqual([]);
  });

  /**
   * Test listing stashes with stash ref set manually.
   */
  it("should list stash entries from refs/stash", async () => {
    const { git, store } = await createInitializedGit();

    // Create initial commit
    await addFile(store, "file.txt", "v1");
    await git.commit().setMessage("initial").call();

    const headRef = await store.refs.resolve("HEAD");
    const headCommit = headRef?.objectId ?? "";

    // Manually create a stash-like commit structure for testing
    // Stash has 2-3 parents: [HEAD, index, optional untracked]
    const indexCommit = await store.commits.storeCommit({
      tree: (await store.commits.loadCommit(headCommit)).tree,
      parents: [headCommit],
      author: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      committer: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      message: "index on main: abc1234 initial",
    });

    const stashCommit = await store.commits.storeCommit({
      tree: (await store.commits.loadCommit(headCommit)).tree,
      parents: [headCommit, indexCommit],
      author: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      committer: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      message: "WIP on main: abc1234 initial",
    });

    // Set refs/stash
    await store.refs.set("refs/stash", stashCommit);

    const stashes = await git.stashList().call();

    expect(stashes.length).toBe(1);
    expect(stashes[0].commitId).toBe(stashCommit);
    expect(stashes[0].headCommit).toBe(headCommit);
    expect(stashes[0].indexCommit).toBe(indexCommit);
    expect(stashes[0].index).toBe(0);
  });
});

describe("StashCreateCommand", () => {
  /**
   * Test creating stash without working tree provider returns undefined.
   */
  it("should require working tree provider for actual stashing", async () => {
    const { git, store } = await createInitializedGit();

    await addFile(store, "file.txt", "content");
    await git.commit().setMessage("initial").call();

    // Without working tree provider, stash create creates a stash but
    // it's effectively a no-op since there are no actual working tree changes
    const stashCommit = await git.stashCreate().call();

    // Should create a stash commit (even though it's not useful without working tree)
    expect(stashCommit).toBeDefined();
  });

  /**
   * Test setting custom message.
   */
  it("should support custom message", async () => {
    const { git, store } = await createInitializedGit();

    await addFile(store, "file.txt", "content");
    await git.commit().setMessage("initial").call();

    const stashCommit = await git.stashCreate().setMessage("My custom stash message").call();

    expect(stashCommit).toBeDefined();
    if (!stashCommit) return;

    // Load the stash commit and check message
    const commit = await store.commits.loadCommit(stashCommit);
    expect(commit.message).toBe("My custom stash message");
  });

  /**
   * Test setIncludeUntracked option.
   */
  it("should support include untracked option", async () => {
    const { git, store } = await createInitializedGit();

    await addFile(store, "file.txt", "content");
    await git.commit().setMessage("initial").call();

    const command = git.stashCreate();
    expect(command.getIncludeUntracked()).toBe(false);

    command.setIncludeUntracked(true);
    expect(command.getIncludeUntracked()).toBe(true);
  });

  /**
   * Test setting ref to null.
   */
  it("should support setting ref to null", async () => {
    const { git, store } = await createInitializedGit();

    await addFile(store, "file.txt", "content");
    await git.commit().setMessage("initial").call();

    // With null ref, no reference is updated
    await git.stashCreate().setRef(null).call();

    // refs/stash should not exist
    const stashRef = await store.refs.get("refs/stash");
    expect(stashRef).toBeUndefined();
  });
});

describe("StashApplyCommand", () => {
  /**
   * Helper to create a stash commit structure.
   */
  async function createStash(
    _git: ReturnType<typeof createInitializedGit> extends Promise<infer T> ? T["git"] : never,
    store: ReturnType<typeof createInitializedGit> extends Promise<infer T> ? T["store"] : never,
  ) {
    const headRef = await store.refs.resolve("HEAD");
    const headCommit = headRef?.objectId ?? "";
    const headCommitObj = await store.commits.loadCommit(headCommit);

    const indexCommit = await store.commits.storeCommit({
      tree: headCommitObj.tree,
      parents: [headCommit],
      author: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      committer: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      message: "index on main: abc1234 test",
    });

    const stashCommit = await store.commits.storeCommit({
      tree: headCommitObj.tree,
      parents: [headCommit, indexCommit],
      author: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      committer: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      message: "WIP on main: abc1234 test",
    });

    await store.refs.set("refs/stash", stashCommit);
    return stashCommit;
  }

  /**
   * Test applying stash.
   */
  it("should apply stash successfully", async () => {
    const { git, store } = await createInitializedGit();

    await addFile(store, "file.txt", "content");
    await git.commit().setMessage("initial").call();

    await createStash(git, store);

    const result = await git.stashApply().call();

    expect(result.status).toBe(StashApplyStatus.OK);
  });

  /**
   * Test applying specific stash.
   */
  it("should support setting stash ref", async () => {
    const { git, store } = await createInitializedGit();

    await addFile(store, "file.txt", "content");
    await git.commit().setMessage("initial").call();

    const stashId = await createStash(git, store);

    const command = git.stashApply();
    expect(command.getStashRef()).toBeUndefined();

    command.setStashRef("stash@{0}");
    expect(command.getStashRef()).toBe("stash@{0}");

    const result = await command.call();
    expect(result.status).toBe(StashApplyStatus.OK);
    expect(result.stashCommit).toBe(stashId);
  });

  /**
   * Test setRestoreIndex option.
   */
  it("should support restoreIndex option", async () => {
    const { git, store } = await createInitializedGit();

    await addFile(store, "file.txt", "content");
    await git.commit().setMessage("initial").call();

    await createStash(git, store);

    const command = git.stashApply();
    expect(command.getRestoreIndex()).toBe(true); // default

    command.setRestoreIndex(false);
    expect(command.getRestoreIndex()).toBe(false);

    const result = await command.call();
    expect(result.status).toBe(StashApplyStatus.OK);
  });

  /**
   * Test setRestoreUntracked option.
   */
  it("should support restoreUntracked option", async () => {
    const { git, store } = await createInitializedGit();

    await addFile(store, "file.txt", "content");
    await git.commit().setMessage("initial").call();

    await createStash(git, store);

    const command = git.stashApply();
    expect(command.getRestoreUntracked()).toBe(true); // default

    command.setRestoreUntracked(false);
    expect(command.getRestoreUntracked()).toBe(false);
  });

  /**
   * Test setStrategy option.
   */
  it("should support merge strategy option", async () => {
    const { git } = await createInitializedGit();

    const command = git.stashApply();
    expect(command.getStrategy()).toBe(MergeStrategy.RECURSIVE); // default

    command.setStrategy(MergeStrategy.RESOLVE);
    expect(command.getStrategy()).toBe(MergeStrategy.RESOLVE);
  });

  /**
   * Test setContentMergeStrategy option.
   */
  it("should support content merge strategy option", async () => {
    const { git } = await createInitializedGit();

    const command = git.stashApply();
    expect(command.getContentMergeStrategy()).toBeUndefined(); // no default

    command.setContentMergeStrategy(ContentMergeStrategy.OURS);
    expect(command.getContentMergeStrategy()).toBe(ContentMergeStrategy.OURS);
  });
});

describe("StashDropCommand", () => {
  /**
   * Test dropping when no stash exists.
   */
  it("should return undefined when no stash to drop", async () => {
    const { git, store } = await createInitializedGit();

    await addFile(store, "file.txt", "content");
    await git.commit().setMessage("initial").call();

    const result = await git.stashDrop().call();

    expect(result).toBeUndefined();
  });

  /**
   * Test dropping stash.
   */
  it("should drop stash entry", async () => {
    const { git, store } = await createInitializedGit();

    await addFile(store, "file.txt", "content");
    await git.commit().setMessage("initial").call();

    const headRef = await store.refs.resolve("HEAD");
    const headCommit = headRef?.objectId ?? "";
    const headCommitObj = await store.commits.loadCommit(headCommit);

    // Create a stash
    const indexCommit = await store.commits.storeCommit({
      tree: headCommitObj.tree,
      parents: [headCommit],
      author: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      committer: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      message: "index",
    });

    const stashCommit = await store.commits.storeCommit({
      tree: headCommitObj.tree,
      parents: [headCommit, indexCommit],
      author: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      committer: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      message: "WIP",
    });

    await store.refs.set("refs/stash", stashCommit);

    // Drop the stash
    const result = await git.stashDrop().call();

    // Should return undefined (no more stashes)
    expect(result).toBeUndefined();

    // refs/stash should be deleted
    const stashRef = await store.refs.get("refs/stash");
    expect(stashRef).toBeUndefined();
  });

  /**
   * Test setAll option.
   */
  it("should support dropping all stashes", async () => {
    const { git, store } = await createInitializedGit();

    await addFile(store, "file.txt", "content");
    await git.commit().setMessage("initial").call();

    const headRef = await store.refs.resolve("HEAD");
    const headCommit = headRef?.objectId ?? "";
    const headCommitObj = await store.commits.loadCommit(headCommit);

    // Create a stash
    const indexCommit = await store.commits.storeCommit({
      tree: headCommitObj.tree,
      parents: [headCommit],
      author: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      committer: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      message: "index",
    });

    const stashCommit = await store.commits.storeCommit({
      tree: headCommitObj.tree,
      parents: [headCommit, indexCommit],
      author: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      committer: { name: "Test", email: "test@test.com", timestamp: 1000, timezoneOffset: 0 },
      message: "WIP",
    });

    await store.refs.set("refs/stash", stashCommit);

    const command = git.stashDrop();
    expect(command.getAll()).toBe(false); // default

    command.setAll(true);
    expect(command.getAll()).toBe(true);

    const result = await command.call();
    expect(result).toBeUndefined();
  });

  /**
   * Test setStashRef option.
   */
  it("should support setting stash index", async () => {
    const { git } = await createInitializedGit();

    const command = git.stashDrop();
    expect(command.getStashRef()).toBe(0); // default

    command.setStashRef(2);
    expect(command.getStashRef()).toBe(2);
  });

  /**
   * Test invalid stash index throws.
   */
  it("should throw for negative stash index", async () => {
    const { git } = await createInitializedGit();

    expect(() => git.stashDrop().setStashRef(-1)).toThrow();
  });
});
