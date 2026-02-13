/**
 * Tests for PullCommand
 *
 * Based on JGit's PullCommandTest.java
 * Tests run against all storage backends (Memory, SQL).
 *
 * Note: PullCommand builds refspecs using the remote name, which doesn't work
 * well with URLs directly. These tests focus on the command's configuration
 * and error handling rather than full integration testing.
 */

import type { WorkingCopy } from "@statewalker/vcs-core";
import { afterEach, describe, expect, it } from "vitest";

import { Git, TagOption } from "../src/index.js";
import { backends } from "./test-helper.js";

describe.each(backends)("PullCommand ($name backend)", ({ factory }) => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
  });

  async function createTestWorkingCopy(): Promise<WorkingCopy> {
    const ctx = await factory();
    cleanup = ctx.cleanup;
    return ctx.workingCopy;
  }
  describe("options", () => {
    it("should default remote to origin", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git.pull();
      expect(command.getRemote()).toBe("origin");
    });

    it("should set remote", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git.pull().setRemote("upstream");
      expect(command.getRemote()).toBe("upstream");
    });

    it("should set remote branch name", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git.pull().setRemoteBranchName("develop");
      expect(command.getRemoteBranchName()).toBe("develop");
    });

    it("should set rebase mode", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git.pull().setRebase(true);
      expect(command.isRebase()).toBe(true);
    });

    it("should support setting merge strategy", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git.pull().setStrategy("recursive");
      expect(command).toBeDefined();
    });

    it("should support fast-forward mode", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git.pull().setFastForwardMode("ff-only");
      expect(command).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("should throw for detached HEAD", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      // Set up detached HEAD by pointing directly to a commit
      await workingCopy.history.refs.set("HEAD", `${"abc".repeat(13)}a`);

      // Pull requires a branch, not a detached HEAD
      await expect(git.pull().call()).rejects.toThrow("Cannot pull with detached HEAD");
    });

    it("should throw for missing HEAD", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      // Don't set up HEAD at all
      await expect(git.pull().call()).rejects.toThrow();
    });
  });

  describe("options getters", () => {
    it("should return correct values for all getters", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git
        .pull()
        .setRemote("upstream")
        .setRemoteBranchName("develop")
        .setRebase(true);

      expect(command.getRemote()).toBe("upstream");
      expect(command.getRemoteBranchName()).toBe("develop");
      expect(command.isRebase()).toBe(true);
    });

    it("should return undefined for unset remote branch name", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git.pull();
      expect(command.getRemoteBranchName()).toBeUndefined();
    });

    it("should default rebase to false", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git.pull();
      expect(command.isRebase()).toBe(false);
    });
  });

  describe("method chaining", () => {
    it("should support fluent API", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git
        .pull()
        .setRemote("upstream")
        .setRemoteBranchName("develop")
        .setRebase(false)
        .setStrategy("recursive")
        .setFastForwardMode("ff");

      expect(command.getRemote()).toBe("upstream");
      expect(command.getRemoteBranchName()).toBe("develop");
    });
  });

  /**
   * JGit-ported tests: Extended options
   */
  describe("extended options (JGit parity)", () => {
    /**
     * JGit: PullCommand.setTagOpt()
     */
    it("should support tag option", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git.pull().setTagOpt(TagOption.FETCH_TAGS);

      expect(command.getTagOpt()).toBe(TagOption.FETCH_TAGS);
    });

    it("should default tag option to undefined", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git.pull();

      expect(command.getTagOpt()).toBeUndefined();
    });

    /**
     * JGit: PullCommand.setFastForward()
     */
    it("should support fast-forward mode getter", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git.pull().setFastForwardMode("ff-only");

      expect(command.getFastForwardMode()).toBe("ff-only");
    });

    it("should return all extended getter values", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git
        .pull()
        .setRemote("upstream")
        .setRemoteBranchName("feature")
        .setRebase(true)
        .setFastForwardMode("ff")
        .setTagOpt(TagOption.NO_TAGS);

      expect(command.getRemote()).toBe("upstream");
      expect(command.getRemoteBranchName()).toBe("feature");
      expect(command.isRebase()).toBe(true);
      expect(command.getFastForwardMode()).toBe("ff");
      expect(command.getTagOpt()).toBe(TagOption.NO_TAGS);
    });
  });
});
