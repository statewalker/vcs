/**
 * Step 7: Checkout Third Commit
 *
 * Extracts the third commit's tree to the git-repo working directory using webrun-vcs API.
 * Then verifies the extraction using native git to ensure files match the commit.
 *
 * Run with: pnpm step:checkout
 */

import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { GitStorage } from "@webrun-vcs/storage-git";
import type { ObjectId } from "@webrun-vcs/vcs";
import { FileMode } from "@webrun-vcs/vcs";
import {
  formatBytes,
  openStorage,
  PerformanceTracker,
  printBanner,
  printInfo,
  printSection,
  REPO_DIR,
  runGitCommand,
  shortId,
} from "../shared/index.js";

const COMMIT_INDEX = 3; // Extract 3rd commit (1-based index)

/**
 * Concatenate Uint8Array chunks into a single array
 */
function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Check if mode represents a tree (directory)
 */
function isTreeMode(mode: number): boolean {
  return (mode & 0o170000) === FileMode.TREE;
}

/**
 * Clean the working directory (remove everything except .git)
 */
async function cleanWorkingDirectory(): Promise<void> {
  const entries = await fs.readdir(REPO_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const fullPath = path.join(REPO_DIR, entry.name);
    await fs.rm(fullPath, { recursive: true, force: true });
  }
}

/**
 * Recursively extract a tree to a directory
 */
async function extractTree(
  storage: GitStorage,
  treeId: ObjectId,
  targetDir: string,
  stats: { files: number; directories: number; totalBytes: number },
): Promise<void> {
  // Create target directory
  await fs.mkdir(targetDir, { recursive: true });

  // Load and iterate tree entries
  for await (const entry of storage.trees.loadTree(treeId)) {
    const entryPath = path.join(targetDir, entry.name);

    if (isTreeMode(entry.mode)) {
      // Recurse into subdirectory
      stats.directories++;
      await extractTree(storage, entry.id, entryPath, stats);
    } else if (entry.mode === FileMode.SYMLINK) {
      // Handle symlinks - read target and create symlink
      const chunks: Uint8Array[] = [];
      for await (const chunk of storage.objects.load(entry.id)) {
        chunks.push(chunk);
      }
      const target = new TextDecoder().decode(concatChunks(chunks));
      try {
        await fs.symlink(target, entryPath);
        stats.files++;
      } catch {
        // Skip symlinks that fail (e.g., on Windows)
      }
    } else if (entry.mode !== FileMode.GITLINK) {
      // Regular file or executable - extract blob content
      const chunks: Uint8Array[] = [];
      for await (const chunk of storage.objects.load(entry.id)) {
        chunks.push(chunk);
      }
      const content = concatChunks(chunks);
      await fs.writeFile(entryPath, content);

      // Set executable permission if needed
      if (entry.mode === FileMode.EXECUTABLE_FILE) {
        await fs.chmod(entryPath, 0o755);
      }

      stats.files++;
      stats.totalBytes += content.length;
    }
    // Skip gitlinks (submodules) - they would require separate clone
  }
}

/**
 * Verify extracted files match the commit using native git
 * Uses git ls-tree to enumerate expected files and git hash-object to verify content
 */
function verifyCheckout(commitId: ObjectId): { success: boolean; diff: string; checked: number } {
  const mismatches: string[] = [];
  let checkedCount = 0;

  try {
    // Get list of all files in the commit
    // Use -c core.quotepath=false to get raw UTF-8 paths instead of escaped octal sequences
    const treeOutput = runGitCommand(
      `git -c core.quotepath=false ls-tree -r ${commitId}`,
      REPO_DIR,
    );
    const lines = treeOutput.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      // Format: <mode> <type> <hash>\t<path>
      const match = line.match(/^(\d+)\s+(\w+)\s+([a-f0-9]+)\t(.+)$/);
      if (!match) continue;

      const [, mode, type, expectedHash, filePath] = match;

      // Skip directories and submodules
      if (type === "tree" || mode === "160000") continue;

      checkedCount++;
      const fullPath = path.join(REPO_DIR, filePath);

      try {
        // Check if file exists
        fsSync.statSync(fullPath);

        if (type === "blob" && mode !== "120000") {
          // Regular file - verify hash
          const actualHash = runGitCommand(`git hash-object "${fullPath}"`, REPO_DIR);
          if (actualHash !== expectedHash) {
            mismatches.push(`M\t${filePath} (hash mismatch)`);
          }
        }
        // Skip symlink verification for simplicity
      } catch {
        mismatches.push(`D\t${filePath} (missing)`);
      }
    }

    return {
      success: mismatches.length === 0,
      diff: mismatches.join("\n"),
      checked: checkedCount,
    };
  } catch (error) {
    const e = error as { message?: string };
    return { success: false, diff: e.message || "Unknown error", checked: checkedCount };
  }
}

export interface CheckoutResult {
  commitId: ObjectId;
  commitMessage: string;
  filesExtracted: number;
  directoriesCreated: number;
  totalBytes: number;
  verified: boolean;
}

export async function checkoutCommit(
  storage: GitStorage,
  tracker?: PerformanceTracker,
): Promise<CheckoutResult> {
  const perf = tracker ?? new PerformanceTracker();

  printSection(`Step 7: Checkout Commit #${COMMIT_INDEX} to Working Directory`);

  // Get HEAD and find the 3rd commit
  const resolved = await storage.refs.resolve("HEAD");
  if (!resolved?.objectId) {
    throw new Error("HEAD reference not found");
  }

  console.log(`  Finding commit #${COMMIT_INDEX} from HEAD...`);

  let targetCommitId: ObjectId | null = null;
  let count = 0;

  for await (const commitId of storage.commits.walkAncestry([resolved.objectId])) {
    count++;
    if (count === COMMIT_INDEX) {
      targetCommitId = commitId;
      break;
    }
  }

  if (!targetCommitId) {
    throw new Error(`Repository has fewer than ${COMMIT_INDEX} commits`);
  }

  const commit = await storage.commits.loadCommit(targetCommitId);
  const firstLine = commit.message.split("\n")[0].substring(0, 60);

  console.log(`  Target commit: ${shortId(targetCommitId)}`);
  console.log(`  Message: ${firstLine}${commit.message.length > 60 ? "..." : ""}`);
  console.log(`  Author: ${commit.author.name}`);
  console.log(`  Tree: ${shortId(commit.tree)}`);

  // Clean working directory (keep .git)
  console.log(`\n  Cleaning working directory: ${REPO_DIR}`);
  await cleanWorkingDirectory();

  // Extract tree to filesystem
  const stats = { files: 0, directories: 0, totalBytes: 0 };

  await perf.measureAsync("checkout_extract", async () => {
    console.log("  Extracting files using webrun-vcs API...");
    await extractTree(storage, commit.tree, REPO_DIR, stats);
  });

  printInfo("\n  Files extracted", stats.files);
  printInfo("  Directories created", stats.directories);
  printInfo("  Total size", formatBytes(stats.totalBytes));

  // Verify using native git
  console.log("\n  Verifying checkout with native git...");
  const verification = verifyCheckout(targetCommitId);

  console.log(`  Files verified: ${verification.checked}`);
  if (verification.success) {
    console.log("  ✓ Verification PASSED: All files match the commit");
  } else {
    console.log("  ✗ Verification FAILED: Files differ from commit");
    console.log("  Differences:");
    for (const line of verification.diff.split("\n").slice(0, 10)) {
      if (line.trim()) console.log(`    ${line}`);
    }
    if (verification.diff.split("\n").length > 10) {
      console.log("    ... (more differences)");
    }
  }

  return {
    commitId: targetCommitId,
    commitMessage: commit.message,
    filesExtracted: stats.files,
    directoriesCreated: stats.directories,
    totalBytes: stats.totalBytes,
    verified: verification.success,
  };
}

// Run as standalone script
if (import.meta.url === `file://${process.argv[1]}`) {
  printBanner("webrun-vcs: Checkout Commit", "Step 7 of 7");

  openStorage()
    .then(async (storage) => {
      const result = await checkoutCommit(storage);
      if (result.verified) {
        console.log("\n  Step 7 completed successfully!\n");
      } else {
        console.log("\n  Step 7 completed with verification errors.\n");
      }
      await storage.close();
    })
    .catch((error) => {
      console.error("\nError:", error);
      process.exit(1);
    });
}
