/**
 * Step 09: Verify Checkout
 *
 * Verifies that the checked out files match the original
 * content stored in the first commit.
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
  logSection("Step 09: Verify Checkout");

  if (state.commits.length === 0) {
    throw new Error("No commits found. Run previous steps first.");
  }

  if (!isGitAvailable()) {
    throw new Error("Git is not available in PATH.");
  }

  // Get first commit's files
  const firstCommit = state.commits[0];
  const expectedFiles = firstCommit.files;

  log("Verifying checked out files match original content...");

  let matchCount = 0;
  let mismatchCount = 0;
  const errors: string[] = [];

  for (const [filePath, expectedContent] of expectedFiles) {
    const fullPath = path.join(REPO_DIR, filePath);

    try {
      const actualContent = await fs.readFile(fullPath, "utf-8");

      if (actualContent === expectedContent) {
        log(`  ✓ ${filePath}`);
        matchCount++;
      } else {
        logError(`  ✗ ${filePath} (content mismatch)`);
        mismatchCount++;
        errors.push(`${filePath}: content mismatch`);
      }
    } catch (error) {
      logError(`  ✗ ${filePath} (not found)`);
      mismatchCount++;
      errors.push(`${filePath}: ${(error as Error).message}`);
    }
  }

  // Summary
  log("\nVerification summary:");
  logInfo("Files verified", matchCount + mismatchCount);
  logInfo("Matches", matchCount);
  logInfo("Mismatches", mismatchCount);

  if (mismatchCount > 0) {
    log("\nErrors:");
    for (const error of errors) {
      logError(`  ${error}`);
    }
    throw new Error(`Verification failed: ${mismatchCount} files did not match`);
  }

  // Additional native git verification
  log("\nNative git verification:");
  const gitStatus = runGitCommand("git status --porcelain");
  if (gitStatus === "") {
    logSuccess("Working directory clean");
  } else {
    log(`  Status:\n${gitStatus}`);
  }

  const gitLog = runGitCommand("git log --oneline -1");
  logInfo("Current commit", gitLog);

  // Switch back to main
  log("\nSwitching back to main branch...");
  runGitCommand("git checkout main");
  logSuccess("Returned to main branch");

  logSuccess("Verification complete! All files match original content.");
}
