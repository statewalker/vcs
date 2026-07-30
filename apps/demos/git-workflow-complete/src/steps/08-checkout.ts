/**
 * Step 08: Checkout First Version
 *
 * Uses git.checkout() to checkout the first commit's files
 * to the staging area (detached HEAD mode).
 */

import { log, logInfo, logSection, logSuccess, shortId, state } from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 08: Checkout First Version");

  const { git, staging } = state;
  if (!git || !staging) {
    throw new Error("Repository not initialized. Run step 01 first.");
  }

  if (state.commits.length === 0) {
    throw new Error("No commits found. Run steps 01-03 first.");
  }

  // Get first commit
  const firstCommit = state.commits[0];
  log(`Checking out first commit: ${shortId(firstCommit.id)}`);
  log(`  Message: ${firstCommit.message}`);

  // Use git.checkout() to checkout the first commit (detached HEAD)
  log("\nRunning git.checkout()...");
  const result = await git.checkout().setName(firstCommit.id).call();

  log(`  Checkout status: ${result.status}`);
  logInfo("Files updated", result.updated.length);
  if (result.removed.length > 0) {
    logInfo("Files removed", result.removed.length);
  }

  // Show checked out files from staging.
  // A repo built via Git.init(...).call() keeps its staging on the store we
  // passed in (workingCopy.checkout is undefined for an init'd repo), and the
  // porcelain checkout command mutates that same store.
  log("\nFiles in staging area:");
  let fileCount = 0;
  for await (const entry of staging.entries()) {
    if (entry.stage === 0) {
      fileCount++;
      if (fileCount <= 10) {
        log(`  ${entry.path}`);
      }
    }
  }
  if (fileCount > 10) {
    log(`  ... and ${fileCount - 10} more files`);
  }

  logInfo("Files checked out", fileCount);
  logSuccess("Checkout complete!");
}
