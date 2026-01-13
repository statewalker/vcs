/**
 * Stash Git Interoperability Tests
 *
 * These tests verify that stash commits created by VCS can be read by native git,
 * and stash commits created by native git can be read by VCS.
 *
 * Stash commit structure (per Git design):
 * - Tree: working tree state (all tracked files)
 * - Parent 1: HEAD at time of stash
 * - Parent 2: commit of current index state
 * - Parent 3 (optional): commit of untracked files
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createPakoCompression, setCompressionUtils } from "@statewalker/vcs-utils";
import { createNodeFilesApi } from "@statewalker/vcs-utils-node/files";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitRepository, FileMode } from "../../src/index.js";

// Initialize compression for tests
setCompressionUtils(createPakoCompression());

/**
 * Run git command in a directory
 */
function git(args: string[], cwd: string): string {
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

describe("Stash Git Interoperability", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "vcs-stash-interop-"));
  });

  afterEach(async () => {
    try {
      execSync(`chmod -R u+w "${testDir}"`, { stdio: "ignore" });
    } catch {
      // Ignore chmod errors
    }
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("Native Git → VCS (reading stash)", () => {
    it("reads stash list created by native git", { timeout: 30000 }, async () => {
      const repoDir = path.join(testDir, "git-stash-repo");

      // Create repository with native git
      git(["init", repoDir], testDir);
      git(["config", "user.email", "test@example.com"], repoDir);
      git(["config", "user.name", "Test User"], repoDir);

      // Create initial commit
      await fs.writeFile(path.join(repoDir, "file.txt"), "Initial content");
      git(["add", "file.txt"], repoDir);
      git(["commit", "-m", "Initial commit"], repoDir);

      // Make changes and stash
      await fs.writeFile(path.join(repoDir, "file.txt"), "Modified content");
      git(["stash", "push", "-m", "My first stash"], repoDir);

      // Make another change and stash
      await fs.writeFile(path.join(repoDir, "file.txt"), "Another modification");
      git(["stash", "push", "-m", "My second stash"], repoDir);

      // Verify native git has two stashes
      const stashList = git(["stash", "list"], repoDir);
      expect(stashList).toContain("stash@{0}");
      expect(stashList).toContain("My second stash");
      expect(stashList).toContain("stash@{1}");
      expect(stashList).toContain("My first stash");

      // Fix permissions on objects
      const objectsDir = path.join(repoDir, ".git", "objects");
      execSync(`chmod -R u+rw "${objectsDir}"`, { stdio: "ignore" });

      // Open repository with VCS
      const files = createNodeFilesApi({ fs, rootDir: repoDir });
      const repo = await createGitRepository(files, ".git", { create: false });

      // Read refs/stash - resolve to get the objectId
      const stashRef = await repo.refs.resolve("refs/stash");
      expect(stashRef).toBeDefined();
      expect(stashRef?.objectId).toBeDefined();

      // Load stash commit
      const stashCommit = await repo.commits.loadCommit(stashRef?.objectId);
      expect(stashCommit).toBeDefined();

      // Verify stash commit structure (2-3 parents)
      expect(stashCommit.parents.length).toBeGreaterThanOrEqual(2);
      expect(stashCommit.message).toContain("My second stash");

      // Parent 1 should be HEAD at time of stash
      const parent1 = await repo.commits.loadCommit(stashCommit.parents[0]);
      expect(parent1.message.trim()).toBe("Initial commit");

      // Parent 2 should be index commit
      const parent2 = await repo.commits.loadCommit(stashCommit.parents[1]);
      expect(parent2).toBeDefined();
      expect(parent2.message).toContain("index on");

      await repo.close();
    });

    it("reads stash tree content created by native git", { timeout: 30000 }, async () => {
      const repoDir = path.join(testDir, "git-stash-tree");

      // Setup repo
      git(["init", repoDir], testDir);
      git(["config", "user.email", "test@example.com"], repoDir);
      git(["config", "user.name", "Test User"], repoDir);

      await fs.writeFile(path.join(repoDir, "file.txt"), "Original");
      git(["add", "file.txt"], repoDir);
      git(["commit", "-m", "Initial"], repoDir);

      // Modify and stash
      await fs.writeFile(path.join(repoDir, "file.txt"), "Stashed content");
      git(["stash", "push", "-m", "Test stash"], repoDir);

      // Fix permissions
      execSync(`chmod -R u+rw "${path.join(repoDir, ".git", "objects")}"`, { stdio: "ignore" });

      // Open with VCS
      const files = createNodeFilesApi({ fs, rootDir: repoDir });
      const repo = await createGitRepository(files, ".git", { create: false });

      // Load stash commit
      const stashRef = await repo.refs.resolve("refs/stash");
      const stashCommit = await repo.commits.loadCommit(stashRef?.objectId);

      // Load stash tree
      const entries: Array<{ name: string; id: string }> = [];
      for await (const entry of repo.trees.loadTree(stashCommit.tree)) {
        entries.push({ name: entry.name, id: entry.id });
      }

      expect(entries.length).toBe(1);
      expect(entries[0].name).toBe("file.txt");

      // Load blob content
      const chunks: Uint8Array[] = [];
      for await (const chunk of repo.blobs.load(entries[0].id)) {
        chunks.push(chunk);
      }
      const content = new TextDecoder().decode(
        chunks.reduce((acc, c) => {
          const result = new Uint8Array(acc.length + c.length);
          result.set(acc);
          result.set(c, acc.length);
          return result;
        }, new Uint8Array(0)),
      );

      expect(content).toBe("Stashed content");

      await repo.close();
    });

    it("reads stash reflog created by native git", { timeout: 30000 }, async () => {
      const repoDir = path.join(testDir, "git-stash-reflog");

      // Setup
      git(["init", repoDir], testDir);
      git(["config", "user.email", "test@example.com"], repoDir);
      git(["config", "user.name", "Test User"], repoDir);

      await fs.writeFile(path.join(repoDir, "file.txt"), "content");
      git(["add", "file.txt"], repoDir);
      git(["commit", "-m", "Initial"], repoDir);

      // Create three stashes
      for (let i = 1; i <= 3; i++) {
        await fs.writeFile(path.join(repoDir, "file.txt"), `content ${i}`);
        git(["stash", "push", "-m", `Stash number ${i}`], repoDir);
      }

      // Read reflog directly
      const reflogPath = path.join(repoDir, ".git", "logs", "refs", "stash");
      const reflogContent = await fs.readFile(reflogPath, "utf-8");

      // Verify reflog format
      const lines = reflogContent.trim().split("\n");
      expect(lines.length).toBe(3);

      // Each line should have format: <old-sha> <new-sha> <author> <timestamp> <tz>\t<message>
      for (const line of lines) {
        expect(line).toMatch(/^[0-9a-f]{40} [0-9a-f]{40} /);
        expect(line).toContain("\t");
      }
    });
  });

  describe("VCS → Native Git (writing stash)", () => {
    it("creates stash commit readable by native git", { timeout: 30000 }, async () => {
      const repoDir = path.join(testDir, "vcs-stash-create");
      await fs.mkdir(repoDir);

      // Create repository with VCS
      const files = createNodeFilesApi({ fs, rootDir: repoDir });
      const repo = await createGitRepository(files, ".git", {
        create: true,
        defaultBranch: "main",
      });

      // Create initial commit
      const encoder = new TextEncoder();
      const blobId = await repo.blobs.store([encoder.encode("Initial content")]);
      const treeId = await repo.trees.storeTree([
        { mode: FileMode.REGULAR_FILE, name: "file.txt", id: blobId },
      ]);

      const now = Math.floor(Date.now() / 1000);
      const author = { name: "VCS Test", email: "vcs@test.com", timestamp: now, tzOffset: "+0000" };

      const headCommit = await repo.commits.storeCommit({
        tree: treeId,
        parents: [],
        author,
        committer: author,
        message: "Initial commit",
      });
      await repo.refs.set("refs/heads/main", headCommit);

      // Create stash structure manually
      // 1. Modified working tree
      const stashedBlob = await repo.blobs.store([encoder.encode("Stashed content")]);
      const stashTree = await repo.trees.storeTree([
        { mode: FileMode.REGULAR_FILE, name: "file.txt", id: stashedBlob },
      ]);

      // 2. Index commit (parent 2)
      const indexCommit = await repo.commits.storeCommit({
        tree: treeId,
        parents: [headCommit],
        author,
        committer: author,
        message: "index on main: Initial commit",
      });

      // 3. Stash commit (2 parents)
      const stashCommit = await repo.commits.storeCommit({
        tree: stashTree,
        parents: [headCommit, indexCommit],
        author,
        committer: author,
        message: "WIP on main: VCS stash test",
      });

      // 4. Write refs/stash
      await repo.refs.set("refs/stash", stashCommit);

      // 5. Write reflog
      const reflogDir = path.join(repoDir, ".git", "logs", "refs");
      await fs.mkdir(reflogDir, { recursive: true });
      const reflogEntry = `${"0".repeat(40)} ${stashCommit} VCS Test <vcs@test.com> ${now} +0000\tstash: WIP on main: VCS stash test\n`;
      await fs.writeFile(path.join(reflogDir, "stash"), reflogEntry);

      await repo.close();

      // Verify native git can read the stash
      const fsckResult = gitSafe(["fsck", "--full"], repoDir);
      expect(fsckResult.ok).toBe(true);

      // Verify stash list
      const stashList = git(["stash", "list"], repoDir);
      expect(stashList).toContain("stash@{0}");
      expect(stashList).toContain("VCS stash test");

      // Verify stash show
      const stashShow = git(["stash", "show", "-p", "stash@{0}"], repoDir);
      expect(stashShow).toContain("file.txt");
      expect(stashShow).toContain("-Initial content");
      expect(stashShow).toContain("+Stashed content");
    });

    it("creates stash that native git can apply", { timeout: 30000 }, async () => {
      const repoDir = path.join(testDir, "vcs-stash-apply");
      await fs.mkdir(repoDir);

      // Create repository with VCS
      const files = createNodeFilesApi({ fs, rootDir: repoDir });
      const repo = await createGitRepository(files, ".git", {
        create: true,
        defaultBranch: "main",
      });

      // Create initial commit
      const encoder = new TextEncoder();
      const blobId = await repo.blobs.store([encoder.encode("Original")]);
      const treeId = await repo.trees.storeTree([
        { mode: FileMode.REGULAR_FILE, name: "test.txt", id: blobId },
      ]);

      const now = Math.floor(Date.now() / 1000);
      const author = { name: "VCS", email: "vcs@test.com", timestamp: now, tzOffset: "+0000" };

      const headCommit = await repo.commits.storeCommit({
        tree: treeId,
        parents: [],
        author,
        committer: author,
        message: "Initial",
      });
      await repo.refs.set("refs/heads/main", headCommit);

      // Create stash with modified content
      const modifiedBlob = await repo.blobs.store([encoder.encode("Modified by stash")]);
      const modifiedTree = await repo.trees.storeTree([
        { mode: FileMode.REGULAR_FILE, name: "test.txt", id: modifiedBlob },
      ]);

      const indexCommit = await repo.commits.storeCommit({
        tree: treeId,
        parents: [headCommit],
        author,
        committer: author,
        message: "index on main: Initial",
      });

      const stashCommit = await repo.commits.storeCommit({
        tree: modifiedTree,
        parents: [headCommit, indexCommit],
        author,
        committer: author,
        message: "WIP on main: Test apply",
      });

      await repo.refs.set("refs/stash", stashCommit);

      // Write reflog
      const reflogDir = path.join(repoDir, ".git", "logs", "refs");
      await fs.mkdir(reflogDir, { recursive: true });
      const reflogEntry = `${"0".repeat(40)} ${stashCommit} VCS <vcs@test.com> ${now} +0000\tstash: WIP on main: Test apply\n`;
      await fs.writeFile(path.join(reflogDir, "stash"), reflogEntry);

      await repo.close();

      // Checkout the working directory with native git
      git(["checkout", "main"], repoDir);

      // Verify initial content
      let content = await fs.readFile(path.join(repoDir, "test.txt"), "utf-8");
      expect(content).toBe("Original");

      // Apply the stash with native git
      git(["stash", "apply"], repoDir);

      // Verify stashed content was applied
      content = await fs.readFile(path.join(repoDir, "test.txt"), "utf-8");
      expect(content).toBe("Modified by stash");
    });
  });

  describe("Stash commit structure validation", () => {
    it(
      "validates stash commit has exactly 2 parents (no untracked)",
      { timeout: 30000 },
      async () => {
        const repoDir = path.join(testDir, "stash-structure-2");

        // Setup with native git
        git(["init", repoDir], testDir);
        git(["config", "user.email", "test@example.com"], repoDir);
        git(["config", "user.name", "Test User"], repoDir);

        await fs.writeFile(path.join(repoDir, "tracked.txt"), "tracked");
        git(["add", "tracked.txt"], repoDir);
        git(["commit", "-m", "Initial"], repoDir);

        // Modify tracked file and stash (no untracked)
        await fs.writeFile(path.join(repoDir, "tracked.txt"), "modified");
        git(["stash", "push", "-m", "Tracked only"], repoDir);

        // Fix permissions
        execSync(`chmod -R u+rw "${path.join(repoDir, ".git", "objects")}"`, { stdio: "ignore" });

        // Open with VCS
        const files = createNodeFilesApi({ fs, rootDir: repoDir });
        const repo = await createGitRepository(files, ".git", { create: false });

        const stashRef = await repo.refs.resolve("refs/stash");
        const stashCommit = await repo.commits.loadCommit(stashRef?.objectId);

        // Without --include-untracked, stash has 2 parents
        expect(stashCommit.parents.length).toBe(2);

        await repo.close();
      },
    );

    it("validates stash commit has 3 parents (with untracked)", { timeout: 30000 }, async () => {
      const repoDir = path.join(testDir, "stash-structure-3");

      // Setup with native git
      git(["init", repoDir], testDir);
      git(["config", "user.email", "test@example.com"], repoDir);
      git(["config", "user.name", "Test User"], repoDir);

      await fs.writeFile(path.join(repoDir, "tracked.txt"), "tracked");
      git(["add", "tracked.txt"], repoDir);
      git(["commit", "-m", "Initial"], repoDir);

      // Create untracked file and stash with --include-untracked
      await fs.writeFile(path.join(repoDir, "tracked.txt"), "modified");
      await fs.writeFile(path.join(repoDir, "untracked.txt"), "untracked content");
      git(["stash", "push", "-u", "-m", "With untracked"], repoDir);

      // Fix permissions
      execSync(`chmod -R u+rw "${path.join(repoDir, ".git", "objects")}"`, { stdio: "ignore" });

      // Open with VCS
      const files = createNodeFilesApi({ fs, rootDir: repoDir });
      const repo = await createGitRepository(files, ".git", { create: false });

      const stashRef = await repo.refs.resolve("refs/stash");
      const stashCommit = await repo.commits.loadCommit(stashRef?.objectId);

      // With --include-untracked (-u), stash has 3 parents
      expect(stashCommit.parents.length).toBe(3);

      // Parent 3 should be the untracked files commit
      const untrackedCommit = await repo.commits.loadCommit(stashCommit.parents[2]);
      expect(untrackedCommit).toBeDefined();

      // Load untracked tree
      const untrackedEntries: string[] = [];
      for await (const entry of repo.trees.loadTree(untrackedCommit.tree)) {
        untrackedEntries.push(entry.name);
      }
      expect(untrackedEntries).toContain("untracked.txt");

      await repo.close();
    });
  });

  describe("Round-trip interoperability", () => {
    it("native git reads VCS stash, VCS reads native git stash", { timeout: 30000 }, async () => {
      const repoDir = path.join(testDir, "stash-roundtrip");

      // Step 1: Create repo with native git
      git(["init", repoDir], testDir);
      git(["config", "user.email", "test@example.com"], repoDir);
      git(["config", "user.name", "Test User"], repoDir);

      await fs.writeFile(path.join(repoDir, "file.txt"), "Initial");
      git(["add", "file.txt"], repoDir);
      git(["commit", "-m", "Initial commit"], repoDir);

      // Step 2: Create first stash with native git
      await fs.writeFile(path.join(repoDir, "file.txt"), "Git stash");
      git(["stash", "push", "-m", "Git stash 1"], repoDir);

      // Fix permissions
      execSync(`chmod -R u+rw "${path.join(repoDir, ".git", "objects")}"`, { stdio: "ignore" });

      // Step 3: VCS reads native git stash
      const files = createNodeFilesApi({ fs, rootDir: repoDir });
      let repo = await createGitRepository(files, ".git", { create: false });

      const gitStashRef = await repo.refs.resolve("refs/stash");
      expect(gitStashRef).toBeDefined();
      expect(gitStashRef?.objectId).toBeDefined();

      const gitStashCommit = await repo.commits.loadCommit(gitStashRef?.objectId);
      expect(gitStashCommit.message).toContain("Git stash 1");

      // Step 4: VCS adds a new stash
      const encoder = new TextEncoder();
      const headCommit = await repo.getHead();

      const vcsBlob = await repo.blobs.store([encoder.encode("VCS stash content")]);
      const vcsTree = await repo.trees.storeTree([
        { mode: FileMode.REGULAR_FILE, name: "file.txt", id: vcsBlob },
      ]);

      const now = Math.floor(Date.now() / 1000);
      const author = {
        name: "VCS User",
        email: "vcs@test.com",
        timestamp: now,
        tzOffset: "+0000",
      };

      // Get original tree for index commit
      if (!headCommit) {
        throw new Error("headCommit should be defined");
      }
      const headTreeId = (await repo.commits.loadCommit(headCommit)).tree;

      const indexCommit = await repo.commits.storeCommit({
        tree: headTreeId,
        parents: [headCommit],
        author,
        committer: author,
        message: "index on main: Initial commit",
      });

      const vcsStashCommit = await repo.commits.storeCommit({
        tree: vcsTree,
        parents: [headCommit, indexCommit],
        author,
        committer: author,
        message: "WIP on main: VCS stash 2",
      });

      // Update refs/stash
      await repo.refs.set("refs/stash", vcsStashCommit);

      // Update reflog
      const reflogPath = path.join(repoDir, ".git", "logs", "refs", "stash");
      const existingReflog = await fs.readFile(reflogPath, "utf-8");
      const newEntry = `${gitStashRef?.objectId} ${vcsStashCommit} VCS User <vcs@test.com> ${now} +0000\tstash: WIP on main: VCS stash 2\n`;
      await fs.writeFile(reflogPath, existingReflog + newEntry);

      await repo.close();

      // Step 5: Native git reads both stashes
      const stashList = git(["stash", "list"], repoDir);
      expect(stashList).toContain("stash@{0}");
      expect(stashList).toContain("VCS stash 2");
      expect(stashList).toContain("stash@{1}");
      expect(stashList).toContain("Git stash 1");

      // Verify integrity
      const fsckResult = gitSafe(["fsck", "--full"], repoDir);
      expect(fsckResult.ok).toBe(true);

      // Step 6: VCS reads both stashes
      repo = await createGitRepository(files, ".git", { create: false });

      const topStashRef = await repo.refs.resolve("refs/stash");
      const topStash = await repo.commits.loadCommit(topStashRef?.objectId);
      expect(topStash.message).toContain("VCS stash 2");

      await repo.close();
    });
  });
});
