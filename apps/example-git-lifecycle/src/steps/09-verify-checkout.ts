/**
 * Step 09: Verify Checkout Matches Stored Version
 *
 * Compares the checked out files with the expected content
 * from the first commit to verify integrity.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  isGitAvailable,
  log,
  logError,
  logInfo,
  logSection,
  logSuccess,
  REPO_DIR,
  runGitCommand,
  state,
} from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 09: Verify Checkout Matches Stored Version");

  if (state.commits.length === 0) {
    throw new Error("No commits found. Run steps 01-03 first.");
  }

  const firstCommit = state.commits[0];
  const expectedFiles = firstCommit.files;

  log(`Verifying ${expectedFiles.size} files from first commit...\n`);

  let matchCount = 0;
  let mismatchCount = 0;
  let missingCount = 0;

  for (const [filePath, expectedContent] of expectedFiles) {
    const fsPath = path.join(REPO_DIR, filePath);

    try {
      const actualContent = await fs.readFile(fsPath, "utf-8");

      if (actualContent === expectedContent) {
        log(`  ✓ ${filePath}`);
        matchCount++;
      } else {
        logError(`${filePath} - content mismatch`);
        log(`    Expected ${expectedContent.length} bytes, got ${actualContent.length} bytes`);
        mismatchCount++;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logError(`${filePath} - file not found`);
        missingCount++;
      } else {
        logError(`${filePath} - ${(error as Error).message}`);
        mismatchCount++;
      }
    }
  }

  log("\nVerification summary:");
  logInfo("  Files matching", matchCount);
  if (mismatchCount > 0) logInfo("  Content mismatches", mismatchCount);
  if (missingCount > 0) logInfo("  Missing files", missingCount);

  // Also verify with native git if available
  if (isGitAvailable()) {
    log("\nNative git verification:");

    // Reset to first commit and verify
    const firstCommitId = firstCommit.id;
    log(`  $ git checkout ${firstCommitId.substring(0, 7)}`);

    const checkoutResult = runGitCommand(`git checkout ${firstCommitId}`);
    if (checkoutResult.startsWith("ERROR")) {
      logError(checkoutResult);
    } else {
      logSuccess("Native git checkout successful");

      // Compare with git diff
      log("\n  $ git diff --stat");
      const diffResult = runGitCommand("git diff --stat");
      if (diffResult === "") {
        logSuccess("No differences from native git checkout");
      } else if (diffResult.startsWith("ERROR")) {
        logError(diffResult);
      } else {
        log(`  ${diffResult}`);
      }

      // Return to main
      runGitCommand("git checkout main");
    }
  }

  // Final result
  log("");
  if (mismatchCount === 0 && missingCount === 0) {
    logSuccess("All files verified successfully!");
    logSuccess("VCS checkout matches stored content perfectly");
  } else {
    logError(`Verification failed: ${mismatchCount + missingCount} issues found`);
  }
}
