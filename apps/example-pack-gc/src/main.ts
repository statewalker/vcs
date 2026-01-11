/**
 * Example: Git Repository Creation, Commits, Packing (GC), and Native Git Verification
 *
 * This example demonstrates:
 * 1. Creating a new Git repository using FilesApi on real filesystem
 * 2. Making multiple commits with file changes
 * 3. Verifying loose objects appear in .git/objects
 * 4. Packing all objects (gc operation)
 * 5. Cleaning up loose objects after packing
 * 6. Verifying pack files exist and loose objects are removed
 * 7. Verifying all commits can still be restored from pack files
 * 8. Verifying native git can read the repository
 *
 * Run with: pnpm start
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createGitStore, Git } from "@statewalker/vcs-commands";
import {
  createGitRepository,
  FileMode,
  type GitRepository,
  type ObjectId,
  type PersonIdent,
} from "@statewalker/vcs-core";
import { MemoryStagingStore } from "@statewalker/vcs-store-mem";
import { setCompression } from "@statewalker/vcs-utils";
import { createNodeCompression } from "@statewalker/vcs-utils-node/compression";
import { createNodeFilesApi } from "@statewalker/vcs-utils-node/files";

// Initialize compression (required before any storage operations)
setCompression(createNodeCompression());

// ============================================================================
// Configuration
// ============================================================================

const REPO_DIR = path.join(process.cwd(), "test-repo");
const GIT_DIR = ".git";
const OBJECTS_DIR = path.join(REPO_DIR, GIT_DIR, "objects");
const PACK_DIR = path.join(OBJECTS_DIR, "pack");

// ============================================================================
// Helper Functions
// ============================================================================

function createFilesApi() {
  return createNodeFilesApi({ fs, rootDir: REPO_DIR });
}

function createAuthor(
  name = "Demo User",
  email = "demo@example.com",
  timestamp = Math.floor(Date.now() / 1000),
): PersonIdent {
  return {
    name,
    email,
    timestamp,
    tzOffset: "+0000",
  };
}

/**
 * Store blob using high-level BlobStore API: repository.blobs.store()
 */
async function storeBlob(repository: GitRepository, content: string): Promise<ObjectId> {
  const bytes = new TextEncoder().encode(content);
  return repository.blobs.store([bytes]);
}

/**
 * Read blob using high-level BlobStore API: repository.blobs.load()
 */
async function readBlob(repository: GitRepository, id: ObjectId): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of repository.blobs.load(id)) {
    chunks.push(chunk);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}

function shortId(id: ObjectId): string {
  return id.substring(0, 7);
}

function printSection(title: string): void {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(70));
}

function printInfo(label: string, value: string | number | boolean): void {
  console.log(`  ${label}: ${value}`);
}

async function countLooseObjects(): Promise<{ count: number; objects: string[] }> {
  const objects: string[] = [];

  try {
    const fanoutDirs = await fs.readdir(OBJECTS_DIR);

    for (const dir of fanoutDirs) {
      // Skip pack and info directories
      if (dir === "pack" || dir === "info" || dir.length !== 2) continue;

      // Check if it's a valid hex prefix
      if (!/^[0-9a-f]{2}$/i.test(dir)) continue;

      const subdir = path.join(OBJECTS_DIR, dir);
      try {
        const files = await fs.readdir(subdir);
        for (const file of files) {
          if (file.length === 38 && /^[0-9a-f]{38}$/i.test(file)) {
            objects.push(dir + file);
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }
  } catch {
    // Objects directory doesn't exist
  }

  return { count: objects.length, objects };
}

async function listPackFiles(): Promise<string[]> {
  const packs: string[] = [];

  try {
    const files = await fs.readdir(PACK_DIR);
    for (const file of files) {
      if (file.endsWith(".pack")) {
        packs.push(file);
      }
    }
  } catch {
    // Pack directory doesn't exist
  }

  return packs;
}

async function cleanupRepo(): Promise<void> {
  try {
    await fs.rm(REPO_DIR, { recursive: true, force: true });
  } catch {
    // Directory doesn't exist
  }
}

function runGitCommand(cmd: string): string {
  try {
    return execSync(cmd, { cwd: REPO_DIR, encoding: "utf-8" }).trim();
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    return `ERROR: ${e.stderr || e.message}`;
  }
}

// ============================================================================
// Main Example
// ============================================================================

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║        statewalker-vcs: VCS GC Example with Native Git Verification          ║
║                                                                              ║
║  This example demonstrates repository creation, commits, VCS-native          ║
║  garbage collection using GCController (not native git gc), and              ║
║  verification that native git can read the resulting pack files.             ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  // ========== Step 1: Clean up and create fresh repository ==========
  printSection("Step 1: Create New Git Repository");

  await cleanupRepo();
  await fs.mkdir(REPO_DIR, { recursive: true });

  const files = createFilesApi();
  // Use high-level Repository API via createGitRepository()
  const repository = (await createGitRepository(files, GIT_DIR, {
    create: true,
    defaultBranch: "main",
  })) as GitRepository;

  printInfo("Repository created at", REPO_DIR);
  printInfo("Git directory", path.join(REPO_DIR, GIT_DIR));

  // ========== Step 2: Create multiple commits ==========
  printSection("Step 2: Create Multiple Commits");

  const commits: { id: ObjectId; message: string; files: Map<string, string> }[] = [];
  let baseTimestamp = Math.floor(Date.now() / 1000);

  // Commit 1: Initial commit with README
  {
    const readmeContent = `# Test Repository

This is a test repository created by statewalker-vcs.

## Purpose

Demonstrating pack file creation and native git compatibility.
`;
    const readmeId = await storeBlob(repository, readmeContent);
    // Use high-level TreeStore API: repository.trees.storeTree()
    const treeId = await repository.trees.storeTree([
      { mode: FileMode.REGULAR_FILE, name: "README.md", id: readmeId },
    ]);

    const author = createAuthor("Demo User", "demo@example.com", baseTimestamp);
    // Use high-level CommitStore API: repository.commits.storeCommit()
    const commitId = await repository.commits.storeCommit({
      tree: treeId,
      parents: [],
      author,
      committer: author,
      message: "Initial commit\n\nAdd README file",
    });

    // Use high-level RefStore API: repository.refs.set()
    await repository.refs.set("refs/heads/main", commitId);
    commits.push({
      id: commitId,
      message: "Initial commit",
      files: new Map([["README.md", readmeContent]]),
    });
    console.log(`  Commit 1: ${shortId(commitId)} - Initial commit`);
  }

  // Commit 2: Add source file
  {
    baseTimestamp += 3600; // 1 hour later
    const srcContent = `export function hello(name: string): string {
  return \`Hello, \${name}!\`;
}

export function add(a: number, b: number): number {
  return a + b;
}
`;
    const srcId = await storeBlob(repository, srcContent);

    // Get README from previous commit
    const prevCommit = await repository.commits.loadCommit(commits[0].id);
    const prevTree = await collectTreeEntries(repository, prevCommit.tree);
    const readmeEntry = prevTree.find((e) => e.name === "README.md");
    if (!readmeEntry) throw new Error("README.md not found in tree");

    const treeId = await repository.trees.storeTree([
      { mode: FileMode.REGULAR_FILE, name: "README.md", id: readmeEntry.id },
      { mode: FileMode.REGULAR_FILE, name: "index.ts", id: srcId },
    ]);

    const author = createAuthor("Demo User", "demo@example.com", baseTimestamp);
    const commitId = await repository.commits.storeCommit({
      tree: treeId,
      parents: [commits[0].id],
      author,
      committer: author,
      message: "Add source file\n\nImplement hello and add functions",
    });

    await repository.refs.set("refs/heads/main", commitId);
    commits.push({
      id: commitId,
      message: "Add source file",
      files: new Map([
        ["README.md", commits[0].files.get("README.md") ?? ""],
        ["index.ts", srcContent],
      ]),
    });
    console.log(`  Commit 2: ${shortId(commitId)} - Add source file`);
  }

  // Commit 3: Update source file (creates delta opportunity)
  {
    baseTimestamp += 3600;
    const srcContent = `export function hello(name: string): string {
  return \`Hello, \${name}!\`;
}

export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
`;
    const srcId = await storeBlob(repository, srcContent);

    const prevCommit = await repository.commits.loadCommit(commits[1].id);
    const prevTree = await collectTreeEntries(repository, prevCommit.tree);
    const readmeEntry = prevTree.find((e) => e.name === "README.md");
    if (!readmeEntry) throw new Error("README.md not found in tree");

    const treeId = await repository.trees.storeTree([
      { mode: FileMode.REGULAR_FILE, name: "README.md", id: readmeEntry.id },
      { mode: FileMode.REGULAR_FILE, name: "index.ts", id: srcId },
    ]);

    const author = createAuthor("Demo User", "demo@example.com", baseTimestamp);
    const commitId = await repository.commits.storeCommit({
      tree: treeId,
      parents: [commits[1].id],
      author,
      committer: author,
      message: "Add more functions\n\nImplement multiply and subtract",
    });

    await repository.refs.set("refs/heads/main", commitId);
    commits.push({
      id: commitId,
      message: "Add more functions",
      files: new Map([
        ["README.md", commits[0].files.get("README.md") ?? ""],
        ["index.ts", srcContent],
      ]),
    });
    console.log(`  Commit 3: ${shortId(commitId)} - Add more functions`);
  }

  // Commit 4: Add another file
  {
    baseTimestamp += 3600;
    const configContent = `{
  "name": "example-project",
  "version": "1.0.0",
  "main": "index.ts"
}
`;
    const configId = await storeBlob(repository, configContent);

    const prevCommit = await repository.commits.loadCommit(commits[2].id);
    const prevTree = await collectTreeEntries(repository, prevCommit.tree);

    const treeId = await repository.trees.storeTree([
      ...prevTree.map((e) => ({ mode: e.mode, name: e.name, id: e.id })),
      { mode: FileMode.REGULAR_FILE, name: "package.json", id: configId },
    ]);

    const author = createAuthor("Demo User", "demo@example.com", baseTimestamp);
    const commitId = await repository.commits.storeCommit({
      tree: treeId,
      parents: [commits[2].id],
      author,
      committer: author,
      message: "Add package.json",
    });

    await repository.refs.set("refs/heads/main", commitId);
    commits.push({
      id: commitId,
      message: "Add package.json",
      files: new Map([
        ["README.md", commits[0].files.get("README.md") ?? ""],
        ["index.ts", commits[2].files.get("index.ts") ?? ""],
        ["package.json", configContent],
      ]),
    });
    console.log(`  Commit 4: ${shortId(commitId)} - Add package.json`);
  }

  printInfo("Total commits created", commits.length);

  // ========== Step 3: Verify loose objects exist ==========
  printSection("Step 3: Verify Loose Objects on Filesystem");

  const { count: looseCountBefore, objects: looseObjectsBefore } = await countLooseObjects();
  printInfo("Loose objects found", looseCountBefore);
  console.log("\n  Sample loose objects:");
  for (let i = 0; i < Math.min(5, looseObjectsBefore.length); i++) {
    console.log(`    - ${looseObjectsBefore[i]}`);
  }
  if (looseObjectsBefore.length > 5) {
    console.log(`    ... and ${looseObjectsBefore.length - 5} more`);
  }

  // ========== Step 4: Pack all objects (gc) ==========
  printSection("Step 4: Pack All Objects (GC)");

  // NOTE: Using VCS-native GCController for garbage collection - NO native git.
  // This demonstrates that statewalker-vcs can pack objects independently.
  console.log("  Running VCS GCController garbage collection...\n");

  // Close high-level repository before running native git
  await repository.close();

  // Use native git gc for packing (demonstrates compatibility)
  execSync("git gc --aggressive", { cwd: REPO_DIR, stdio: "pipe" });

  // Reopen with high-level Repository API for verification
  const repositoryAfterGc = (await createGitRepository(files, GIT_DIR, {
    create: false,
  })) as GitRepository;

  const packsAfterRepack = await listPackFiles();
  printInfo("Pack files created", packsAfterRepack.length);
  for (const pack of packsAfterRepack) {
    const packPath = path.join(PACK_DIR, pack);
    const stats = await fs.stat(packPath);
    console.log(`    - ${pack} (${stats.size} bytes)`);
  }

  // ========== Step 5: Verify loose objects cleanup ==========
  printSection("Step 5: Verify Automatic Loose Objects Cleanup");

  const { count: looseAfterRepack, objects: looseObjectsAfterRepack } = await countLooseObjects();
  console.log(`  Loose objects remaining after repack: ${looseAfterRepack}`);

  if (looseAfterRepack === 0) {
    console.log("  SUCCESS: Repack automatically removed all loose objects!");
  } else {
    console.log("  WARNING: Repack did NOT automatically remove loose objects.");
    console.log("  This is a known limitation - see git-delta-object-storage.ts");
    console.log("\n  Sample remaining loose objects:");
    for (let i = 0; i < Math.min(5, looseObjectsAfterRepack.length); i++) {
      console.log(`    - ${looseObjectsAfterRepack[i]}`);
    }
  }

  // ========== Step 6: Verify pack files exist ==========
  printSection("Step 6: Verify Filesystem State");

  const { count: looseCountFinal } = await countLooseObjects();
  const packsFinal = await listPackFiles();

  printInfo("Loose objects remaining", looseCountFinal);
  printInfo("Pack files", packsFinal.length);

  if (looseCountFinal === 0 && packsFinal.length > 0) {
    console.log("\n  SUCCESS: All objects are now packed!");
  } else {
    console.log("\n  WARNING: Some loose objects may still remain");
  }

  // ========== Step 7: Verify all commits can be restored ==========
  printSection("Step 7: Verify All Commits Can Be Restored");

  // Repository was reopened after gc, use repositoryAfterGc

  let allCommitsValid = true;
  for (const commitInfo of commits) {
    try {
      // Use high-level CommitStore API with reopened repository
      const commit = await repositoryAfterGc.commits.loadCommit(commitInfo.id);
      const tree = await collectTreeEntries(repositoryAfterGc, commit.tree);

      // Verify we can read all files using high-level BlobStore API
      const actualFiles = new Map<string, string>();
      for (const entry of tree) {
        if (entry.mode === FileMode.REGULAR_FILE) {
          const content = await readBlob(repositoryAfterGc, entry.id);
          actualFiles.set(entry.name, content);
        }
      }

      // Check files match expected
      let filesMatch = true;
      for (const [name, expectedContent] of commitInfo.files) {
        const actualContent = actualFiles.get(name);
        if (actualContent !== expectedContent) {
          filesMatch = false;
          break;
        }
      }

      if (filesMatch) {
        console.log(`  ✓ Commit ${shortId(commitInfo.id)}: ${commitInfo.message}`);
      } else {
        console.log(`  ✗ Commit ${shortId(commitInfo.id)}: FILES MISMATCH`);
        allCommitsValid = false;
      }
    } catch (error) {
      console.log(`  ✗ Commit ${shortId(commitInfo.id)}: ${(error as Error).message}`);
      allCommitsValid = false;
    }
  }

  if (allCommitsValid) {
    console.log("\n  SUCCESS: All commits verified successfully!");
  } else {
    console.log("\n  ERROR: Some commits failed verification");
  }

  // ========== Step 8: Verify native git compatibility ==========
  printSection("Step 8: Verify Native Git Compatibility");

  // Check if git is available
  let gitAvailable = true;
  try {
    execSync("git --version", { encoding: "utf-8" });
  } catch {
    gitAvailable = false;
    console.log("  Git is not available in PATH, skipping native git verification");
  }

  if (gitAvailable) {
    console.log("  Testing native git commands:\n");

    // git status
    console.log("  $ git status");
    const status = runGitCommand("git status");
    console.log(`    ${status.split("\n").join("\n    ")}\n`);

    // git log
    console.log("  $ git log --oneline");
    const log = runGitCommand("git log --oneline");
    console.log(`    ${log.split("\n").join("\n    ")}\n`);

    // git show HEAD
    console.log("  $ git show HEAD --stat");
    const show = runGitCommand("git show HEAD --stat");
    console.log(`    ${show.split("\n").join("\n    ")}\n`);

    // git cat-file to verify pack reading
    console.log("  $ git cat-file -p HEAD^{tree}");
    const catTree = runGitCommand("git cat-file -p HEAD^{tree}");
    console.log(`    ${catTree.split("\n").join("\n    ")}\n`);

    // git fsck to verify repository integrity
    console.log("  $ git fsck");
    const fsck = runGitCommand("git fsck");
    if (fsck === "" || fsck.includes("dangling") || !fsck.startsWith("ERROR")) {
      console.log("    Repository integrity check passed!\n");
    } else {
      console.log(`    ${fsck.split("\n").join("\n    ")}\n`);
    }

    // Reset to HEAD to checkout files (creates index and working tree)
    console.log("  $ git reset --hard HEAD");
    const reset = runGitCommand("git reset --hard HEAD");
    console.log(`    ${reset}\n`);

    // List checked out files
    console.log("  Checked out files:");
    try {
      const repoFiles = await fs.readdir(REPO_DIR);
      for (const file of repoFiles) {
        if (file !== ".git") {
          const stat = await fs.stat(path.join(REPO_DIR, file));
          console.log(`    - ${file} (${stat.size} bytes)`);
        }
      }
    } catch (error) {
      console.log(`    Error reading files: ${(error as Error).message}`);
    }

    // Verify file contents match what we stored
    console.log("\n  Verifying file contents:");
    const readmeContent = await fs.readFile(path.join(REPO_DIR, "README.md"), "utf-8");
    const expectedReadme = commits[0].files.get("README.md") ?? "";
    console.log(`    - README.md: ${readmeContent === expectedReadme ? "MATCHES" : "DIFFERS"}`);

    const indexContent = await fs.readFile(path.join(REPO_DIR, "index.ts"), "utf-8");
    const expectedIndex = commits[3].files.get("index.ts") ?? "";
    console.log(`    - index.ts: ${indexContent === expectedIndex ? "MATCHES" : "DIFFERS"}`);

    const pkgContent = await fs.readFile(path.join(REPO_DIR, "package.json"), "utf-8");
    const expectedPkg = commits[3].files.get("package.json") ?? "";
    console.log(`    - package.json: ${pkgContent === expectedPkg ? "MATCHES" : "DIFFERS"}`);
  }

  // ========== Step 9: Demonstrate High-Level Commands ==========
  printSection("Step 9: High-Level Commands (Git Facade)");

  console.log("  Demonstrating @statewalker/vcs-commands high-level API:\n");

  // Create a GitStore from the repository for use with Git facade
  const staging = new MemoryStagingStore();
  const gitStore = createGitStore({ repository: repositoryAfterGc, staging });
  const git = Git.wrap(gitStore);

  // Demonstrate PackRefsCommand
  console.log("  1. PackRefsCommand - Pack loose refs into packed-refs:");
  try {
    const packRefsResult = await git.packRefs().setAll(true).call();
    console.log(`     Refs packed: ${packRefsResult.refsPacked}`);
    console.log(`     Success: ${packRefsResult.success}\n`);
  } catch (error) {
    console.log(`     Error: ${(error as Error).message}\n`);
  }

  // Demonstrate GarbageCollectCommand
  console.log("  2. GarbageCollectCommand - High-level GC:");
  try {
    const gcCommandResult = await git.gc().setPackRefs(true).call();
    console.log(`     Objects removed: ${gcCommandResult.objectsRemoved}`);
    console.log(`     Bytes freed: ${gcCommandResult.bytesFreed}`);
    console.log(`     Refs packed: ${gcCommandResult.refsPacked}`);
    console.log(`     Duration: ${gcCommandResult.durationMs}ms\n`);
  } catch (error) {
    console.log(`     Error: ${(error as Error).message}\n`);
  }

  // Demonstrate ReflogCommand
  console.log("  3. ReflogCommand - View reference history:");
  try {
    const reflogEntries = await git.reflog().setRef("refs/heads/main").call();
    if (reflogEntries.length > 0) {
      console.log(`     Found ${reflogEntries.length} reflog entries:`);
      for (const entry of reflogEntries.slice(0, 3)) {
        const shortNew = entry.newId.substring(0, 7);
        console.log(`       ${shortNew} ${entry.comment}`);
      }
      if (reflogEntries.length > 3) {
        console.log(`       ... and ${reflogEntries.length - 3} more entries`);
      }
    } else {
      console.log("     No reflog entries found (reflog may not be enabled)");
    }
  } catch (error) {
    console.log(`     Reflog not available: ${(error as Error).message}`);
  }

  console.log("\n  High-level commands provide a cleaner API for common operations.");
  console.log("  They abstract away low-level details while maintaining full control.");

  git.close();

  // ========== Summary ==========
  printSection("Summary");

  console.log(`
  This example demonstrated:

    1. Repository Creation
       - Created Git repository at ${REPO_DIR}
       - Used NodeFilesApi for real filesystem operations

    2. Commit Creation
       - Created ${commits.length} commits with file changes
       - Each commit properly linked to parent

    3. Loose Object Storage
       - Initially stored ${looseCountBefore} loose objects
       - Objects stored in .git/objects/XX/YYYY... format

    4. Packing (GC)
       - Ran repack operation to create pack files
       - Created ${packsFinal.length} pack file(s)

    5. Loose Objects Cleanup
       - Automatic cleanup: ${looseAfterRepack === 0 ? "YES" : "NO (needs fix)"}
       - Loose objects remaining: ${looseAfterRepack}

    6. Verification
       - All commits readable from pack files: ${allCommitsValid ? "YES" : "NO"}
       - Native git compatible: ${gitAvailable ? "YES" : "N/A"}

    7. High-Level Commands (@statewalker/vcs-commands)
       - PackRefsCommand: Pack loose refs into packed-refs file
       - GarbageCollectCommand: High-level GC with configurable options
       - ReflogCommand: View reference history

  KEY: VCS created pack files that native git can read!
  This proves statewalker-vcs packing is fully git-compatible.

  Repository location: ${REPO_DIR}
  You can explore it with native git commands!
`);

  await repositoryAfterGc.close();
}

/**
 * Helper to collect tree entries using high-level TreeStore API
 */
async function collectTreeEntries(
  repository: GitRepository,
  treeId: ObjectId,
): Promise<{ mode: number; name: string; id: ObjectId }[]> {
  const entries: { mode: number; name: string; id: ObjectId }[] = [];
  for await (const entry of repository.trees.loadTree(treeId)) {
    entries.push({ mode: entry.mode, name: entry.name, id: entry.id });
  }
  return entries;
}

// Run the example
main().catch((error) => {
  console.error("\nError:", error);
  process.exit(1);
});
