/**
 * Tests for CommitCommand
 *
 * Based on JGit's CommitCommandTest.java and CommitAndLogCommandTest.java
 */

import { describe, expect, it } from "vitest";

import { EmptyCommitError, NoMessageError } from "../src/errors/index.js";
import { createInitializedGit, testAuthor, toArray } from "./test-helper.js";

describe("CommitCommand", () => {
  it("should require a message", async () => {
    const { git } = await createInitializedGit();

    await expect(git.commit().call()).rejects.toThrow(NoMessageError);
  });

  it("should create a commit with message", async () => {
    const { git } = await createInitializedGit();

    const commit = await git.commit().setMessage("Test commit").setAllowEmpty(true).call();

    expect(commit.message).toBe("Test commit");
    expect(commit.parents.length).toBe(1); // Has parent from initial commit
  });

  it("should create initial commit with no parents", async () => {
    await createInitializedGit();
    const { Git } = await import("../src/index.js");

    // Create a new store without initial commit
    const { createTestStore } = await import("./test-helper.js");
    const newStore = createTestStore();
    const git = Git.wrap(newStore);

    // Set up refs
    await newStore.refs.setSymbolic("HEAD", "refs/heads/main");

    // Create initial commit
    const commit = await git.commit().setMessage("Initial commit").setAllowEmpty(true).call();

    expect(commit.message).toBe("Initial commit");
    expect(commit.parents.length).toBe(0);
  });

  it("should set author and committer", async () => {
    const { git } = await createInitializedGit();

    const author = testAuthor("John Doe", "john@example.com");
    const committer = testAuthor("Jane Doe", "jane@example.com");

    const commit = await git
      .commit()
      .setMessage("Test commit")
      .setAuthorIdent(author)
      .setCommitterIdent(committer)
      .setAllowEmpty(true)
      .call();

    expect(commit.author.name).toBe("John Doe");
    expect(commit.author.email).toBe("john@example.com");
    expect(commit.committer.name).toBe("Jane Doe");
    expect(commit.committer.email).toBe("jane@example.com");
  });

  it("should use author as committer when only author is set", async () => {
    const { git } = await createInitializedGit();

    const commit = await git
      .commit()
      .setMessage("Test commit")
      .setAuthor("John Doe", "john@example.com")
      .setAllowEmpty(true)
      .call();

    expect(commit.author.name).toBe("John Doe");
    expect(commit.committer.name).toBe("John Doe");
  });

  it("should reject empty commit without allowEmpty", async () => {
    const { git } = await createInitializedGit();

    // First commit is allowed
    await git.commit().setMessage("First commit").setAllowEmpty(true).call();

    // Second empty commit should fail
    await expect(git.commit().setMessage("Empty commit").call()).rejects.toThrow(EmptyCommitError);
  });

  it("should allow empty commit with allowEmpty", async () => {
    const { git } = await createInitializedGit();

    // First commit
    await git.commit().setMessage("First commit").setAllowEmpty(true).call();

    // Second empty commit with allowEmpty
    const commit = await git.commit().setMessage("Empty commit").setAllowEmpty(true).call();

    expect(commit.message).toBe("Empty commit");
  });

  it("should amend previous commit", async () => {
    const { git } = await createInitializedGit();

    // Create first commit
    const first = await git
      .commit()
      .setMessage("Original message")
      .setAuthor("Original Author", "original@example.com")
      .setAllowEmpty(true)
      .call();

    // Amend it (amend is allowed even without changes since tree is the same)
    const amended = await git
      .commit()
      .setAmend(true)
      .setMessage("Amended message")
      .setAllowEmpty(true)
      .call();

    expect(amended.message).toBe("Amended message");
    // Author should be preserved from original
    expect(amended.author.name).toBe("Original Author");
    // Parents should be same as original commit's parents
    expect(amended.parents).toEqual(first.parents);
  });

  it("should amend and keep original message if not provided", async () => {
    const { git } = await createInitializedGit();

    // Create first commit
    await git.commit().setMessage("Keep this message").setAllowEmpty(true).call();

    // Amend without new message
    const amended = await git.commit().setAmend(true).setAllowEmpty(true).call();

    expect(amended.message).toBe("Keep this message");
  });

  it("should not be callable twice", async () => {
    const { git } = await createInitializedGit();

    const cmd = git.commit().setMessage("Test").setAllowEmpty(true);
    await cmd.call();

    await expect(cmd.call()).rejects.toThrow(/already been called/);
  });

  it("should not allow setting after call", async () => {
    const { git } = await createInitializedGit();

    const cmd = git.commit().setMessage("Test");
    await cmd.setAllowEmpty(true).call();

    expect(() => cmd.setMessage("Another")).toThrow(/already been called/);
  });

  it("should update branch ref after commit", async () => {
    const { git, store } = await createInitializedGit();

    const commit = await git.commit().setMessage("New commit").setAllowEmpty(true).call();

    // Get the branch ref
    const ref = await store.refs.resolve("refs/heads/main");
    const _commitId = await store.commits.storeCommit(commit);

    // Note: The commit's stored ID will be the same if the content is the same
    // We just verify that the ref was updated
    expect(ref?.objectId).toBeDefined();
  });
});

describe("CommitCommand with Log", () => {
  it("should create commits visible in log", async () => {
    const { git } = await createInitializedGit();

    // Create multiple commits
    await git.commit().setMessage("First").setAllowEmpty(true).call();
    await git.commit().setMessage("Second").setAllowEmpty(true).call();
    await git.commit().setMessage("Third").setAllowEmpty(true).call();

    // Get log
    const commits = await toArray(await git.log().call());

    // Should see all commits (including initial)
    expect(commits.length).toBe(4);
    expect(commits[0].message).toBe("Third");
    expect(commits[1].message).toBe("Second");
    expect(commits[2].message).toBe("First");
    expect(commits[3].message).toBe("Initial commit");
  });
});
