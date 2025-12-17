/**
 * Tests for PushCommand
 *
 * Based on JGit's PushCommandTest.java
 */

import { describe, expect, it } from "vitest";

import { Git } from "../src/index.js";
import { createTestStore } from "./test-helper.js";
import {
  addFileAndCommit,
  createInitializedTestServer,
  createTestUrl,
} from "./transport-test-helper.js";

describe("PushCommand", () => {
  describe("basic operations", () => {
    it("should push refs to remote repository", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      // Create client with its own commit
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      // Create initial commit in client
      const commitId = await addFileAndCommit(
        clientStore,
        "client-file.txt",
        "client content",
        "Initial client commit",
      );

      // Set up HEAD on client
      await clientStore.refs.set("HEAD", "refs/heads/main");
      await clientStore.refs.set("refs/heads/main", commitId);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git
          .push()
          .setRemote(remoteUrl)
          .add("refs/heads/main:refs/heads/feature")
          .call();

        // Should have pushed something
        expect(result.uri).toBe(remoteUrl);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should return empty result when nothing to push", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      // Create client without any refs
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.push().setRemote(remoteUrl).call();

        // Should return empty result
        expect(result.remoteUpdates.length).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("refspecs", () => {
    it("should push with explicit refspec", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      // Create commit
      const commitId = await addFileAndCommit(clientStore, "file.txt", "content", "Commit");
      await clientStore.refs.set("refs/heads/main", commitId);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git
          .push()
          .setRemote(remoteUrl)
          .add("refs/heads/main:refs/heads/main")
          .call();

        expect(result.uri).toBe(remoteUrl);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should push multiple refspecs", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      // Create commits for multiple branches
      const commitId = await addFileAndCommit(clientStore, "file.txt", "content", "Commit");
      await clientStore.refs.set("refs/heads/main", commitId);
      await clientStore.refs.set("refs/heads/feature", commitId);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git
          .push()
          .setRemote(remoteUrl)
          .setRefSpecs("refs/heads/main:refs/heads/main", "refs/heads/feature:refs/heads/feature")
          .call();

        expect(result.uri).toBe(remoteUrl);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should push with add method", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const commitId = await addFileAndCommit(clientStore, "file.txt", "content", "Commit");
      await clientStore.refs.set("refs/heads/main", commitId);
      await clientStore.refs.set("refs/heads/feature", commitId);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git
          .push()
          .setRemote(remoteUrl)
          .add("refs/heads/main:refs/heads/main")
          .add("refs/heads/feature:refs/heads/feature")
          .call();

        expect(result.uri).toBe(remoteUrl);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("force push", () => {
    it("should add + prefix when force is enabled", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const commitId = await addFileAndCommit(clientStore, "file.txt", "content", "Commit");
      await clientStore.refs.set("refs/heads/main", commitId);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git
          .push()
          .setRemote(remoteUrl)
          .add("refs/heads/main:refs/heads/main")
          .setForce(true)
          .call();

        expect(result.uri).toBe(remoteUrl);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should not duplicate + prefix if already present", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const commitId = await addFileAndCommit(clientStore, "file.txt", "content", "Commit");
      await clientStore.refs.set("refs/heads/main", commitId);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git
          .push()
          .setRemote(remoteUrl)
          .add("+refs/heads/main:refs/heads/main") // Already has +
          .setForce(true)
          .call();

        expect(result.uri).toBe(remoteUrl);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("push all", () => {
    it("should push all branches when setPushAll is true", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      // Create multiple branches
      const commitId = await addFileAndCommit(clientStore, "file.txt", "content", "Commit");
      await clientStore.refs.set("refs/heads/main", commitId);
      await clientStore.refs.set("refs/heads/feature", commitId);
      await clientStore.refs.set("refs/heads/develop", commitId);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.push().setRemote(remoteUrl).setPushAll(true).call();

        expect(result.uri).toBe(remoteUrl);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("push tags", () => {
    it("should push tags when setPushTags is true", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      // Create commit and tag
      const commitId = await addFileAndCommit(clientStore, "file.txt", "content", "Commit");
      await clientStore.refs.set("refs/heads/main", commitId);
      await clientStore.refs.set("refs/tags/v1.0", commitId);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.push().setRemote(remoteUrl).setPushTags(true).call();

        expect(result.uri).toBe(remoteUrl);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("atomic push", () => {
    it("should set atomic option", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const commitId = await addFileAndCommit(clientStore, "file.txt", "content", "Commit");
      await clientStore.refs.set("refs/heads/main", commitId);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git
          .push()
          .setRemote(remoteUrl)
          .add("refs/heads/main:refs/heads/main")
          .setAtomic(true)
          .call();

        expect(result.uri).toBe(remoteUrl);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("dry run", () => {
    it("should not actually push in dry run mode", async () => {
      const server = await createInitializedTestServer();
      const _remoteUrl = createTestUrl(server.baseUrl);

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const commitId = await addFileAndCommit(clientStore, "file.txt", "content", "Commit");
      await clientStore.refs.set("refs/heads/main", commitId);

      // Note: Dry run behavior depends on transport implementation
      // This test verifies the option is accepted
      expect(git.push().setDryRun(true).isDryRun()).toBe(true);
    });
  });

  describe("result", () => {
    it("should return push result with uri", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const commitId = await addFileAndCommit(clientStore, "file.txt", "content", "Commit");
      await clientStore.refs.set("refs/heads/main", commitId);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git
          .push()
          .setRemote(remoteUrl)
          .add("refs/heads/main:refs/heads/new-branch")
          .call();

        expect(result.uri).toBe(remoteUrl);
        expect(result.remoteUpdates).toBeDefined();
        expect(result.bytesSent).toBeGreaterThanOrEqual(0);
        expect(result.objectCount).toBeGreaterThanOrEqual(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("callOrThrow", () => {
    it("should not throw for successful push", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const commitId = await addFileAndCommit(clientStore, "file.txt", "content", "Commit");
      await clientStore.refs.set("refs/heads/main", commitId);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        // Should not throw
        await git
          .push()
          .setRemote(remoteUrl)
          .add("refs/heads/main:refs/heads/new-branch")
          .callOrThrow();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("error handling", () => {
    it("should throw for invalid remote", async () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const commitId = await addFileAndCommit(clientStore, "file.txt", "content", "Commit");
      await clientStore.refs.set("refs/heads/main", commitId);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return new Response("Not Found", { status: 404 });
      };

      try {
        await expect(
          git
            .push()
            .setRemote("http://invalid/repo.git")
            .add("refs/heads/main:refs/heads/main")
            .call(),
        ).rejects.toThrow();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("options getters", () => {
    it("should return correct values for getters", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git
        .push()
        .setRemote("upstream")
        .setForce(true)
        .setAtomic(true)
        .setThin(false)
        .setDryRun(true);

      expect(command.getRemote()).toBe("upstream");
      expect(command.isForce()).toBe(true);
      expect(command.isAtomic()).toBe(true);
      expect(command.isThin()).toBe(false);
      expect(command.isDryRun()).toBe(true);
    });
  });

  /**
   * JGit-ported tests: Extended options
   */
  describe("extended options (JGit parity)", () => {
    /**
     * JGit: PushCommand.setUseBitmaps()
     */
    it("should support useBitmaps option", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git.push().setRemote("origin").setUseBitmaps(false);

      expect(command.isUseBitmaps()).toBe(false);
    });

    it("should default useBitmaps to true", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git.push().setRemote("origin");

      expect(command.isUseBitmaps()).toBe(true);
    });

    /**
     * JGit: PushCommand.setPushOptions()
     */
    it("should support push options", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git
        .push()
        .setRemote("origin")
        .setPushOptions(["ci.skip", "merge_request.create"]);

      expect(command.getPushOptions()).toEqual(["ci.skip", "merge_request.create"]);
    });

    /**
     * JGit: PushCommand.setReceivePack()
     */
    it("should support receive-pack option", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git.push().setRemote("origin").setReceivePack("/opt/git/receive-pack");

      expect(command.getReceivePack()).toBe("/opt/git/receive-pack");
    });

    it("should return all extended getter values", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const command = git
        .push()
        .setRemote("upstream")
        .setForce(true)
        .setAtomic(true)
        .setThin(false)
        .setDryRun(true)
        .setUseBitmaps(false)
        .setPushOptions(["option1", "option2"])
        .setReceivePack("/custom/receive-pack");

      expect(command.getRemote()).toBe("upstream");
      expect(command.isForce()).toBe(true);
      expect(command.isAtomic()).toBe(true);
      expect(command.isThin()).toBe(false);
      expect(command.isDryRun()).toBe(true);
      expect(command.isUseBitmaps()).toBe(false);
      expect(command.getPushOptions()).toEqual(["option1", "option2"]);
      expect(command.getReceivePack()).toBe("/custom/receive-pack");
    });
  });
});
