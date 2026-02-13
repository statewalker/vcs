/**
 * Tests for CloneCommand
 *
 * Based on JGit's CloneCommandTest.java
 * Tests run against all storage backends (Memory, SQL).
 */

import type { Ref, WorkingCopy } from "@statewalker/vcs-core";
import { afterEach, describe, expect, it } from "vitest";

import { Git, TagOption } from "../src/index.js";
import { backends } from "./test-helper.js";
import {
  addFileAndCommit,
  createInitializedTestServer,
  createTestUrl,
} from "./transport-test-helper.js";

describe.each(backends)("CloneCommand ($name backend)", ({ factory }) => {
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
  describe("basic operations", () => {
    it("should clone a repository", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      // Create a new WorkingCopy for the clone
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.clone().setURI(remoteUrl).call();

        // Should have cloned something
        expect(result.fetchResult).toBeDefined();
        expect(result.fetchResult.uri).toBe(remoteUrl);
        expect(result.remoteName).toBe("origin");

        // Should have set up tracking refs
        expect(result.fetchResult.trackingRefUpdates.length).toBeGreaterThan(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should clone and set up default branch", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.clone().setURI(remoteUrl).call();

        // Should have default branch info
        expect(result.defaultBranch).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should clone with multiple commits", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      // Add more commits on server
      await addFileAndCommit(server.serverStores, "file2.txt", "content 2", "Second commit");
      await addFileAndCommit(server.serverStores, "file3.txt", "content 3", "Third commit");

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.clone().setURI(remoteUrl).call();

        expect(result.fetchResult).toBeDefined();
        expect(result.fetchResult.bytesReceived).toBeGreaterThan(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("branch option", () => {
    it("should clone specific branch", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      // Create additional branch on server
      const mainRef = (await server.serverStores.refs.get("refs/heads/main")) as Ref | undefined;
      await server.serverStores.refs.set("refs/heads/feature", mainRef?.objectId ?? "");

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.clone().setURI(remoteUrl).setBranch("feature").call();

        expect(result.fetchResult).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should accept full ref name for branch", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.clone().setURI(remoteUrl).setBranch("refs/heads/main").call();

        expect(result.fetchResult).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("shallow clone", () => {
    it("should clone with depth option", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      // Add more commits
      await addFileAndCommit(server.serverStores, "file2.txt", "content 2", "Second commit");
      await addFileAndCommit(server.serverStores, "file3.txt", "content 3", "Third commit");

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.clone().setURI(remoteUrl).setDepth(1).call();

        expect(result.fetchResult).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should reject invalid depth", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      expect(() => git.clone().setURI("http://example.com/repo.git").setDepth(0)).toThrow(
        "Depth must be at least 1",
      );

      expect(() => git.clone().setURI("http://example.com/repo.git").setDepth(-1)).toThrow(
        "Depth must be at least 1",
      );
    });
  });

  describe("bare clone", () => {
    it("should clone as bare repository", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.clone().setURI(remoteUrl).setBare(true).call();

        expect(result.bare).toBe(true);
        expect(result.fetchResult).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("no checkout", () => {
    it("should clone without checkout", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.clone().setURI(remoteUrl).setNoCheckout(true).call();

        expect(result.fetchResult).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("remote name", () => {
    it("should use custom remote name", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.clone().setURI(remoteUrl).setRemote("upstream").call();

        expect(result.remoteName).toBe("upstream");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should default to origin", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.clone().setURI(remoteUrl).call();

        expect(result.remoteName).toBe("origin");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("error handling", () => {
    it("should throw for missing URI", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      await expect(git.clone().call()).rejects.toThrow("URI must be specified for clone");
    });

    it("should throw for invalid remote", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return new Response("Not Found", { status: 404 });
      };

      try {
        await expect(git.clone().setURI("http://invalid/repo.git").call()).rejects.toThrow();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("options getters", () => {
    it("should return correct values for getters", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git
        .clone()
        .setURI("http://example.com/repo.git")
        .setBranch("develop")
        .setRemote("upstream")
        .setBare(true)
        .setNoCheckout(true);

      expect(command.getURI()).toBe("http://example.com/repo.git");
      expect(command.getBranch()).toBe("develop");
      expect(command.getRemote()).toBe("upstream");
      expect(command.isBare()).toBe(true);
      expect(command.isNoCheckout()).toBe(true);
    });
  });

  describe("clone all branches", () => {
    it("should support setCloneAllBranches option", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.clone().setURI(remoteUrl).setCloneAllBranches(false).call();

        expect(result.fetchResult).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    /**
     * JGit: CloneCommandTest.testCloneRepositoryAllBranchesTakesPreference()
     */
    it("should have cloneAllBranches take precedence over branchesToClone", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      // Create additional branch on server
      const mainRef = (await server.serverStores.refs.get("refs/heads/main")) as Ref | undefined;
      await server.serverStores.refs.set("refs/heads/test", mainRef?.objectId ?? "");

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const command = git
          .clone()
          .setURI(remoteUrl)
          .setCloneAllBranches(true)
          .setBranchesToClone(["refs/heads/test"]);

        expect(command.isCloneAllBranches()).toBe(true);
        expect(command.getBranchesToClone()).toEqual(["refs/heads/test"]);

        const result = await command.call();
        expect(result.fetchResult).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  /**
   * JGit-ported tests: Mirror mode
   */
  describe("mirror clone", () => {
    /**
     * JGit: CloneCommandTest.testBareCloneRepositoryMirror()
     */
    it("should clone with mirror option implying bare", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const command = git.clone().setURI(remoteUrl).setMirror(true);

        // Mirror implies bare
        expect(command.isMirror()).toBe(true);
        expect(command.isBare()).toBe(true);

        const result = await command.call();
        expect(result.fetchResult).toBeDefined();
        expect(result.bare).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  /**
   * JGit-ported tests: Tag options
   */
  describe("tag options", () => {
    /**
     * JGit: CloneCommandTest.testCloneNoTags()
     */
    it("should clone with no tags option", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const command = git.clone().setURI(remoteUrl).setNoTags();

        expect(command.getTagOption()).toBe(TagOption.NO_TAGS);

        const result = await command.call();
        expect(result.fetchResult).toBeDefined();

        // Tags should be filtered out
        const tagRefs = result.fetchResult.trackingRefUpdates.filter((u) =>
          u.localRef.startsWith("refs/tags/"),
        );
        expect(tagRefs.length).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    /**
     * JGit: CloneCommandTest.testCloneFollowTags()
     */
    it("should clone with fetch tags option", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const command = git.clone().setURI(remoteUrl).setTagOption(TagOption.FETCH_TAGS);

        expect(command.getTagOption()).toBe(TagOption.FETCH_TAGS);

        const result = await command.call();
        expect(result.fetchResult).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should default to auto follow tags", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git.clone().setURI("http://example.com/repo.git");

      expect(command.getTagOption()).toBe(TagOption.AUTO_FOLLOW);
    });
  });

  /**
   * JGit-ported tests: Branches to clone
   */
  describe("branches to clone", () => {
    /**
     * JGit: CloneCommandTest.testCloneRepositoryOnlyOneBranch()
     */
    it("should clone only specified branches", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const command = git
          .clone()
          .setURI(remoteUrl)
          .setBranch("main")
          .setBranchesToClone(["refs/heads/main"])
          .setCloneAllBranches(false);

        expect(command.getBranchesToClone()).toEqual(["refs/heads/main"]);
        expect(command.isCloneAllBranches()).toBe(false);

        const result = await command.call();
        expect(result.fetchResult).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  /**
   * JGit-ported tests: Shallow clone options
   */
  describe("shallow clone options", () => {
    /**
     * JGit: CloneCommandTest.testCloneRepositoryWithShallowSince()
     */
    it("should support shallow since option", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const date = new Date("2024-01-01");
      const command = git.clone().setURI("http://example.com/repo.git").setShallowSince(date);

      expect(command.getShallowSince()).toEqual(date);
    });

    /**
     * JGit: CloneCommandTest.testCloneRepositoryWithShallowExclude()
     */
    it("should support shallow exclude option", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const command = git
        .clone()
        .setURI("http://example.com/repo.git")
        .addShallowExclude("abc123")
        .addShallowExclude("def456");

      expect(command.getShallowExcludes()).toEqual(["abc123", "def456"]);
    });
  });

  /**
   * JGit-ported tests: Extended options getters
   */
  describe("extended options getters", () => {
    it("should return correct values for all getters", async () => {
      const workingCopy = await createTestWorkingCopy();
      const git = Git.fromWorkingCopy(workingCopy);

      const date = new Date("2024-06-15");
      const command = git
        .clone()
        .setURI("http://example.com/repo.git")
        .setBranch("develop")
        .setRemote("upstream")
        .setBare(true)
        .setNoCheckout(true)
        .setMirror(false)
        .setCloneAllBranches(true)
        .setBranchesToClone(["refs/heads/main", "refs/heads/develop"])
        .setTagOption(TagOption.FETCH_TAGS)
        .setShallowSince(date)
        .addShallowExclude("commit1")
        .addShallowExclude("commit2");

      expect(command.getURI()).toBe("http://example.com/repo.git");
      expect(command.getBranch()).toBe("develop");
      expect(command.getRemote()).toBe("upstream");
      expect(command.isBare()).toBe(true);
      expect(command.isNoCheckout()).toBe(true);
      expect(command.isMirror()).toBe(false);
      expect(command.isCloneAllBranches()).toBe(true);
      expect(command.getBranchesToClone()).toEqual(["refs/heads/main", "refs/heads/develop"]);
      expect(command.getTagOption()).toBe(TagOption.FETCH_TAGS);
      expect(command.getShallowSince()).toEqual(date);
      expect(command.getShallowExcludes()).toEqual(["commit1", "commit2"]);
    });
  });
});
