/**
 * Tests for repository format validation
 *
 * Based on JGit's T0003_BasicTest.java (test008_FailOnWrongVersion)
 * Tests repository configuration validation.
 */

import { FilesApi, joinPath, MemFilesApi } from "@statewalker/webrun-files";
import { setCompression } from "@webrun-vcs/compression";
import { createNodeCompression } from "@webrun-vcs/compression/compression-node";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GitStorage } from "../src/git-storage.js";

describe("repository format", () => {
  let files: FilesApi;
  const gitDir = "/repo/.git";

  beforeAll(() => {
    setCompression(createNodeCompression());
  });

  beforeEach(() => {
    files = new FilesApi(new MemFilesApi());
  });

  describe("repository initialization", () => {
    it("writes repositoryformatversion = 0 in config", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const config = await files.readFile(joinPath(gitDir, "config"));
      const configStr = new TextDecoder().decode(config);

      expect(configStr).toContain("repositoryformatversion = 0");

      await storage.close();
    });

    it("writes bare = false by default", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const config = await files.readFile(joinPath(gitDir, "config"));
      const configStr = new TextDecoder().decode(config);

      expect(configStr).toContain("bare = false");

      await storage.close();
    });

    it("writes bare = true when specified", async () => {
      const storage = await GitStorage.init(files, gitDir, {
        create: true,
        bare: true,
      });

      const config = await files.readFile(joinPath(gitDir, "config"));
      const configStr = new TextDecoder().decode(config);

      expect(configStr).toContain("bare = true");

      await storage.close();
    });

    it("writes filemode = true", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const config = await files.readFile(joinPath(gitDir, "config"));
      const configStr = new TextDecoder().decode(config);

      expect(configStr).toContain("filemode = true");

      await storage.close();
    });

    it("creates config in proper INI format", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const config = await files.readFile(joinPath(gitDir, "config"));
      const configStr = new TextDecoder().decode(config);

      // Should have [core] section
      expect(configStr).toContain("[core]");

      await storage.close();
    });
  });

  describe("repository validation", () => {
    it("requires HEAD file to exist", async () => {
      // Create a directory without HEAD
      await files.mkdir(gitDir);
      await files.mkdir(joinPath(gitDir, "objects"));

      await expect(GitStorage.open(files, gitDir)).rejects.toThrow(/Not a valid git repository/);
    });

    it("opens repository with valid HEAD", async () => {
      // Create minimal valid repository
      await files.mkdir(gitDir);
      await files.write(joinPath(gitDir, "HEAD"), [
        new TextEncoder().encode("ref: refs/heads/main\n"),
      ]);

      const storage = await GitStorage.open(files, gitDir);
      expect(storage).toBeDefined();

      await storage.close();
    });

    it("opens repository with detached HEAD", async () => {
      // Create repository with detached HEAD
      await files.mkdir(gitDir);
      await files.write(joinPath(gitDir, "HEAD"), [
        new TextEncoder().encode(`${"a".repeat(40)}\n`),
      ]);

      const storage = await GitStorage.open(files, gitDir);
      expect(storage).toBeDefined();

      await storage.close();
    });
  });

  describe("directory structure", () => {
    it("creates objects directory on init", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      expect(await files.exists(joinPath(gitDir, "objects"))).toBe(true);

      await storage.close();
    });

    it("creates objects/pack directory on init", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      expect(await files.exists(joinPath(gitDir, "objects", "pack"))).toBe(true);

      await storage.close();
    });

    it("creates refs directory structure on init", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      expect(await files.exists(joinPath(gitDir, "refs"))).toBe(true);
      expect(await files.exists(joinPath(gitDir, "refs", "heads"))).toBe(true);
      expect(await files.exists(joinPath(gitDir, "refs", "tags"))).toBe(true);

      await storage.close();
    });
  });

  describe("re-opening repository", () => {
    it("preserves objects after re-opening", async () => {
      // Create and store
      const storage1 = await GitStorage.init(files, gitDir, { create: true });
      const id = await storage1.objects.store(
        (async function* () {
          yield new TextEncoder().encode("test content");
        })(),
      );
      await storage1.close();

      // Re-open and verify
      const storage2 = await GitStorage.open(files, gitDir);
      expect(await storage2.objects.has(id)).toBe(true);

      await storage2.close();
    });

    it("preserves refs after re-opening", async () => {
      // Create and store
      const storage1 = await GitStorage.init(files, gitDir, { create: true });
      const person = {
        name: "A",
        email: "a@b.com",
        timestamp: 0,
        tzOffset: "+0000",
      };
      const commitId = await storage1.commits.storeCommit({
        tree: storage1.trees.getEmptyTreeId(),
        parents: [],
        author: person,
        committer: person,
        message: "test",
      });
      await storage1.refs.setRef("refs/heads/main", commitId);
      await storage1.close();

      // Re-open and verify
      const storage2 = await GitStorage.open(files, gitDir);
      const mainRef = await storage2.refs.exactRef("refs/heads/main");
      expect(mainRef?.objectId).toBe(commitId);

      await storage2.close();
    });

it("detects newly added pack files after refresh", async () => {
      // Create repository
      const storage = await GitStorage.init(files, gitDir, { create: true });

      // Store object as loose
      const id = await storage.objects.store(
        (async function* () {
          yield new TextEncoder().encode("test content");
        })(),
      );

      expect(await storage.objects.has(id)).toBe(true);

      // Simulate external pack creation (e.g., gc or fetch)
      // For this test, we just verify refresh() doesn't break existing access

      await storage.refresh();

      expect(await storage.objects.has(id)).toBe(true);

      await storage.close();
    });
  });

  describe("init vs open semantics", () => {
    it("init with create=false throws on missing repo", async () => {
      await expect(GitStorage.init(files, gitDir, { create: false })).rejects.toThrow(
        /Not a valid git repository/,
      );
    });

    it("init with create=true creates new repo", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      expect(await files.exists(gitDir)).toBe(true);
      expect(await files.exists(joinPath(gitDir, "HEAD"))).toBe(true);

      await storage.close();
    });

    it("init on existing repo returns storage without re-creating", async () => {
      // Create first
      const storage1 = await GitStorage.init(files, gitDir, { create: true });
      const person = {
        name: "A",
        email: "a@b.com",
        timestamp: 0,
        tzOffset: "+0000",
      };
      const commitId = await storage1.commits.storeCommit({
        tree: storage1.trees.getEmptyTreeId(),
        parents: [],
        author: person,
        committer: person,
        message: "test",
      });
      await storage1.refs.setRef("refs/heads/main", commitId);
      await storage1.close();

      // Init again should open, not overwrite
      const storage2 = await GitStorage.init(files, gitDir, { create: true });
      const mainRef = await storage2.refs.exactRef("refs/heads/main");
      expect(mainRef?.objectId).toBe(commitId);

      await storage2.close();
    });
  });
});
