/**
 * Git Interoperability Tests
 *
 * These tests verify that VCS can read/write Git repositories
 * created by native git, and vice versa.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createPakoCompression, setCompressionUtils } from "@statewalker/vcs-utils";
import { createNodeFilesApi } from "@statewalker/vcs-utils-node/files";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitRepository, FileMode } from "../../src/index.js";

// Initialize compression for tests - use pako for universal compatibility
setCompressionUtils(createPakoCompression());

/**
 * Run git command in a directory
 */
function git(args: string[], cwd: string): string {
  // Quote arguments that contain spaces
  const quotedArgs = args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg));
  return execSync(`git ${quotedArgs.join(" ")}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Run git command and return success/failure
 */
function gitSafe(args: string[], cwd: string): { ok: boolean; output: string } {
  try {
    const output = git(args, cwd);
    return { ok: true, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message };
  }
}

describe("Git Interoperability", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "vcs-git-interop-"));
  });

  afterEach(async () => {
    // Fix permissions before cleanup (git gc creates read-only pack files)
    try {
      execSync(`chmod -R u+w "${testDir}"`, { stdio: "ignore" });
    } catch {
      // Ignore chmod errors
    }
    // Clean up temp directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("Native Git → VCS (reading)", () => {
    it("reads loose objects created by native git", { timeout: 30000 }, async () => {
      const repoDir = path.join(testDir, "git-repo");

      // Create repository with native git
      git(["init", repoDir], testDir);
      git(["config", "user.email", "test@example.com"], repoDir);
      git(["config", "user.name", "Test User"], repoDir);

      // Create a file and commit with native git
      await fs.writeFile(
        path.join(repoDir, "README.md"),
        "# Test Repository\n\nCreated by native git.",
      );
      git(["add", "README.md"], repoDir);
      git(["commit", "-m", "Initial commit"], repoDir);

      // Get the commit hash from native git
      const commitHash = git(["rev-parse", "HEAD"], repoDir);
      expect(commitHash).toHaveLength(40);

      // Fix permissions on loose objects (git creates read-only files)
      const objectsDir = path.join(repoDir, ".git", "objects");
      execSync(`chmod -R u+rw "${objectsDir}"`, { stdio: "ignore" });

      // Open repository with VCS
      const files = createNodeFilesApi({ fs, rootDir: repoDir });
      const repo = await createGitRepository(files, ".git", { create: false });

      // Verify VCS can read the commit
      const head = await repo.getHead();
      expect(head).toBe(commitHash);

      // Verify VCS can load the commit
      const commit = await repo.commits.loadCommit(commitHash);
      expect(commit.message).toContain("Initial commit");
      expect(commit.author.name).toBe("Test User");

      // Verify VCS can load the tree
      const treeEntries: Array<{ name: string; mode: number; id: string }> = [];
      for await (const entry of repo.trees.loadTree(commit.tree)) {
        treeEntries.push(entry);
      }
      expect(treeEntries).toHaveLength(1);
      expect(treeEntries[0].name).toBe("README.md");

      // Verify VCS can load the blob
      const blobChunks: Uint8Array[] = [];
      for await (const chunk of repo.blobs.load(treeEntries[0].id)) {
        blobChunks.push(chunk);
      }
      const blobContent = new TextDecoder().decode(
        blobChunks.reduce((acc, chunk) => {
          const result = new Uint8Array(acc.length + chunk.length);
          result.set(acc);
          result.set(chunk, acc.length);
          return result;
        }, new Uint8Array(0)),
      );
      expect(blobContent).toContain("# Test Repository");

      await repo.close();
    });

    it("reads pack files created by native git", { timeout: 60000 }, async () => {
      const repoDir = path.join(testDir, "git-repo-packed");

      // Create repository with native git
      git(["init", repoDir], testDir);
      git(["config", "user.email", "test@example.com"], repoDir);
      git(["config", "user.name", "Test User"], repoDir);

      // Create multiple commits to have objects to pack
      for (let i = 1; i <= 3; i++) {
        await fs.writeFile(path.join(repoDir, `file${i}.txt`), `Content of file ${i}`);
        git(["add", `file${i}.txt`], repoDir);
        git(["commit", "-m", `Add file ${i}`], repoDir);
      }

      // Pack objects with native git
      git(["gc", "--aggressive"], repoDir);

      // Fix permissions on pack files (git gc creates read-only files)
      const packDir = path.join(repoDir, ".git", "objects", "pack");
      execSync(`chmod -R u+rw "${packDir}"`, { stdio: "ignore" });

      // Verify pack file exists
      const packFiles = await fs.readdir(packDir);
      const hasPackFile = packFiles.some((f) => f.endsWith(".pack"));
      expect(hasPackFile).toBe(true);

      // Get the commit hash from native git
      const commitHash = git(["rev-parse", "HEAD"], repoDir);

      // Open repository with VCS
      const files = createNodeFilesApi({ fs, rootDir: repoDir });
      const repo = await createGitRepository(files, ".git", { create: false });

      // Verify VCS can read from pack files
      const head = await repo.getHead();
      expect(head).toBe(commitHash);

      // Load the commit from pack
      const commit = await repo.commits.loadCommit(commitHash);
      expect(commit.message).toContain("Add file 3");

      // Load tree entries from pack
      const treeEntries: Array<{ name: string }> = [];
      for await (const entry of repo.trees.loadTree(commit.tree)) {
        treeEntries.push({ name: entry.name });
      }
      expect(treeEntries.map((e) => e.name).sort()).toEqual([
        "file1.txt",
        "file2.txt",
        "file3.txt",
      ]);

      await repo.close();
    });
  });

  describe("VCS → Native Git (writing)", () => {
    it("creates repository readable by native git", { timeout: 30000 }, async () => {
      const repoDir = path.join(testDir, "vcs-repo");
      await fs.mkdir(repoDir);

      // Create repository with VCS
      const files = createNodeFilesApi({ fs, rootDir: repoDir });
      const repo = await createGitRepository(files, ".git", {
        create: true,
        defaultBranch: "main",
      });

      // Create content with VCS
      const encoder = new TextEncoder();
      const blobId = await repo.blobs.store([
        encoder.encode("# VCS Repository\n\nCreated by VCS library."),
      ]);

      const treeId = await repo.trees.storeTree([
        { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId },
      ]);

      const now = Math.floor(Date.now() / 1000);
      const commitId = await repo.commits.storeCommit({
        tree: treeId,
        parents: [],
        author: { name: "VCS Test", email: "vcs@test.com", timestamp: now, tzOffset: "+0000" },
        committer: { name: "VCS Test", email: "vcs@test.com", timestamp: now, tzOffset: "+0000" },
        message: "Initial VCS commit",
      });

      await repo.refs.set("refs/heads/main", commitId);
      await repo.close();

      // Verify native git can read the repository
      const fsckResult = gitSafe(["fsck", "--full"], repoDir);
      if (!fsckResult.ok) {
        console.log("fsck failed:", fsckResult.output);
      }
      expect(fsckResult.ok).toBe(true);

      // Verify native git sees the commit
      const logOutput = git(["log", "--oneline", "-1"], repoDir);
      expect(logOutput).toContain("Initial VCS commit");

      // Verify native git can read the tree
      const treeOutput = git(["ls-tree", "--name-only", "HEAD"], repoDir);
      expect(treeOutput).toBe("README.md");

      // Verify native git can read the blob content
      const catOutput = git(["cat-file", "-p", `HEAD:README.md`], repoDir);
      expect(catOutput).toContain("# VCS Repository");
    });

    it("creates commits that native git can checkout", { timeout: 30000 }, async () => {
      const repoDir = path.join(testDir, "vcs-checkout");
      await fs.mkdir(repoDir);

      // Create repository with VCS
      const files = createNodeFilesApi({ fs, rootDir: repoDir });
      const repo = await createGitRepository(files, ".git", {
        create: true,
        defaultBranch: "main",
      });

      // Create content with VCS
      const encoder = new TextEncoder();
      const blob1 = await repo.blobs.store([encoder.encode("File 1 content")]);
      const blob2 = await repo.blobs.store([encoder.encode("File 2 content")]);

      const treeId = await repo.trees.storeTree([
        { mode: FileMode.REGULAR_FILE, name: "file1.txt", id: blob1 },
        { mode: FileMode.REGULAR_FILE, name: "file2.txt", id: blob2 },
      ]);

      const now = Math.floor(Date.now() / 1000);
      const commitId = await repo.commits.storeCommit({
        tree: treeId,
        parents: [],
        author: { name: "VCS", email: "vcs@test.com", timestamp: now, tzOffset: "+0000" },
        committer: { name: "VCS", email: "vcs@test.com", timestamp: now, tzOffset: "+0000" },
        message: "Add files",
      });

      await repo.refs.set("refs/heads/main", commitId);
      await repo.close();

      // Use native git to checkout
      git(["checkout", "main"], repoDir);

      // Verify files were checked out
      const file1Content = await fs.readFile(path.join(repoDir, "file1.txt"), "utf-8");
      const file2Content = await fs.readFile(path.join(repoDir, "file2.txt"), "utf-8");

      expect(file1Content).toBe("File 1 content");
      expect(file2Content).toBe("File 2 content");
    });
  });

  describe("Round-trip interoperability", () => {
    it.skipIf(process.env.CI)(
      "VCS reads what native git wrote, native git reads what VCS wrote",
      { timeout: 30000 },
      async () => {
        const repoDir = path.join(testDir, "roundtrip");

        // Step 1: Create repo with native git
        git(["init", repoDir], testDir);
        git(["config", "user.email", "test@example.com"], repoDir);
        git(["config", "user.name", "Test User"], repoDir);

        await fs.writeFile(path.join(repoDir, "file1.txt"), "Original content");
        git(["add", "file1.txt"], repoDir);
        git(["commit", "-m", "Initial commit"], repoDir);

        const gitCommit1 = git(["rev-parse", "HEAD"], repoDir);

        // Fix permissions on loose objects (git creates read-only files)
        const objectsDir = path.join(repoDir, ".git", "objects");
        execSync(`chmod -R u+rw "${objectsDir}"`, { stdio: "ignore" });

        // Step 2: VCS reads what git wrote
        const files = createNodeFilesApi({ fs, rootDir: repoDir });
        const repo = await createGitRepository(files, ".git", { create: false });

        const vcsHead1 = await repo.getHead();
        expect(vcsHead1).toBe(gitCommit1);
        if (!vcsHead1) {
          throw new Error("vcsHead1 should be defined");
        }

        // Step 3: VCS adds a new commit
        const encoder = new TextEncoder();
        const existingCommit = await repo.commits.loadCommit(vcsHead1);

        // Load existing tree and add new file
        const existingEntries: Array<{ mode: number; name: string; id: string }> = [];
        for await (const entry of repo.trees.loadTree(existingCommit.tree)) {
          existingEntries.push(entry);
        }

        const newBlob = await repo.blobs.store([encoder.encode("New file from VCS")]);
        const newTree = await repo.trees.storeTree([
          ...existingEntries,
          { mode: FileMode.REGULAR_FILE, name: "file2.txt", id: newBlob },
        ]);

        const now = Math.floor(Date.now() / 1000);
        const vcsCommit = await repo.commits.storeCommit({
          tree: newTree,
          parents: [vcsHead1],
          author: { name: "VCS", email: "vcs@test.com", timestamp: now, tzOffset: "+0000" },
          committer: { name: "VCS", email: "vcs@test.com", timestamp: now, tzOffset: "+0000" },
          message: "Add file via VCS",
        });

        await repo.refs.set("refs/heads/main", vcsCommit);
        await repo.close();

        // Step 4: Native git reads what VCS wrote
        const gitCommit2 = git(["rev-parse", "HEAD"], repoDir);
        expect(gitCommit2).toBe(vcsCommit);

        const gitLog = git(["log", "--oneline"], repoDir);
        expect(gitLog).toContain("Add file via VCS");
        expect(gitLog).toContain("Initial commit");

        // Verify integrity
        const fsckResult = gitSafe(["fsck", "--full"], repoDir);
        expect(fsckResult.ok).toBe(true);

        // Checkout and verify content
        git(["checkout", "--force", "HEAD"], repoDir);
        const file2Content = await fs.readFile(path.join(repoDir, "file2.txt"), "utf-8");
        expect(file2Content).toBe("New file from VCS");
      },
    );
  });
});
