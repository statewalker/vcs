/**
 * Tests for PullCommand
 *
 * Based on JGit's PullCommandTest.java
 *
 * Note: PullCommand builds refspecs using the remote name, which doesn't work
 * well with URLs directly. These tests focus on the command's configuration
 * and error handling rather than full integration testing.
 */

import { describe, expect, it } from "vitest";

import { Git } from "../src/index.js";
import { createTestStore } from "./test-helper.js";

describe("PullCommand", () => {
  describe("options", () => {
    it("should default remote to origin", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git.pull();
      expect(command.getRemote()).toBe("origin");
    });

    it("should set remote", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git.pull().setRemote("upstream");
      expect(command.getRemote()).toBe("upstream");
    });

    it("should set remote branch name", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git.pull().setRemoteBranchName("develop");
      expect(command.getRemoteBranchName()).toBe("develop");
    });

    it("should set rebase mode", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git.pull().setRebase(true);
      expect(command.isRebase()).toBe(true);
    });

    it("should support setting merge strategy", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git.pull().setStrategy("recursive");
      expect(command).toBeDefined();
    });

    it("should support fast-forward mode", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git.pull().setFastForwardMode("ff-only");
      expect(command).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("should throw for detached HEAD", async () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      // Set up detached HEAD by pointing directly to a commit
      await clientStore.refs.set("HEAD", `${"abc".repeat(13)}a`);

      // Pull requires a branch, not a detached HEAD
      await expect(git.pull().call()).rejects.toThrow("Cannot pull with detached HEAD");
    });

    it("should throw for missing HEAD", async () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      // Don't set up HEAD at all
      await expect(git.pull().call()).rejects.toThrow();
    });
  });

  describe("options getters", () => {
    it("should return correct values for all getters", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git
        .pull()
        .setRemote("upstream")
        .setRemoteBranchName("develop")
        .setRebase(true);

      expect(command.getRemote()).toBe("upstream");
      expect(command.getRemoteBranchName()).toBe("develop");
      expect(command.isRebase()).toBe(true);
    });

    it("should return undefined for unset remote branch name", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git.pull();
      expect(command.getRemoteBranchName()).toBeUndefined();
    });

    it("should default rebase to false", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git.pull();
      expect(command.isRebase()).toBe(false);
    });
  });

  describe("method chaining", () => {
    it("should support fluent API", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

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
});
