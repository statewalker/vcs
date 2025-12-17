/**
 * Tests for CloneCommand
 *
 * Based on JGit's CloneCommandTest.java
 */

import type { Ref } from "@webrun-vcs/vcs";
import { describe, expect, it } from "vitest";

import { Git } from "../src/index.js";
import { createTestStore } from "./test-helper.js";
import {
  addFileAndCommit,
  createInitializedTestServer,
  createTestUrl,
} from "./transport-test-helper.js";

describe("CloneCommand", () => {
  describe("basic operations", () => {
    it("should clone a repository", async () => {
      const server = await createInitializedTestServer();
      const remoteUrl = createTestUrl(server.baseUrl);

      // Create a new store for the clone
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

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

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

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
      await addFileAndCommit(server.serverStore, "file2.txt", "content 2", "Second commit");
      await addFileAndCommit(server.serverStore, "file3.txt", "content 3", "Third commit");

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

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
      const mainRef = (await server.serverStore.refs.get("refs/heads/main")) as Ref | undefined;
      await server.serverStore.refs.set("refs/heads/feature", mainRef?.objectId ?? "");

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

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

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

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
      await addFileAndCommit(server.serverStore, "file2.txt", "content 2", "Second commit");
      await addFileAndCommit(server.serverStore, "file3.txt", "content 3", "Third commit");

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.clone().setURI(remoteUrl).setDepth(1).call();

        expect(result.fetchResult).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should reject invalid depth", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

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

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

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

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

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

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

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

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

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
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      await expect(git.clone().call()).rejects.toThrow("URI must be specified for clone");
    });

    it("should throw for invalid remote", async () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

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
    it("should return correct values for getters", () => {
      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

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

      const clientStore = createTestStore();
      const git = Git.wrap(clientStore);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = server.mockFetch;

      try {
        const result = await git.clone().setURI(remoteUrl).setCloneAllBranches(false).call();

        expect(result.fetchResult).toBeDefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
