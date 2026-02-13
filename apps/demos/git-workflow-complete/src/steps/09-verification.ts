/**
 * Step 09: Verify Checkout
 *
 * Verifies that the checked out files match the original
 * content stored in the first commit using git.status() and blob reading.
 */

import { log, logError, logInfo, logSection, logSuccess, state } from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 09: Verify Checkout");

  const { git } = state;
  if (!git) {
    throw new Error("Repository not initialized. Run step 01 first.");
  }

  if (state.commits.length === 0) {
    throw new Error("No commits found. Run previous steps first.");
  }

  // Get first commit's files
  const firstCommit = state.commits[0];
  const expectedFiles = firstCommit.files;

  log("Verifying checked out files match original content...");

  const store = git.getStore();
  let matchCount = 0;
  let mismatchCount = 0;
  const errors: string[] = [];

  // Build a map of staged files
  const stagedFiles = new Map<string, string>();
  for await (const entry of store.staging.listEntries()) {
    if (entry.stage === 0) {
      stagedFiles.set(entry.path, entry.objectId);
    }
  }

  // Check each expected file
  for (const [filePath, expectedContent] of expectedFiles) {
    const objectId = stagedFiles.get(filePath);

    if (!objectId) {
      logError(`  ✗ ${filePath} (not in staging)`);
      mismatchCount++;
      errors.push(`${filePath}: not in staging area`);
      continue;
    }

    try {
      // Read blob content
      const chunks: Uint8Array[] = [];
      for await (const chunk of store.blobs.load(objectId)) {
        chunks.push(chunk);
      }
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      const actualContent = new TextDecoder().decode(result);

      if (actualContent === expectedContent) {
        log(`  ✓ ${filePath}`);
        matchCount++;
      } else {
        logError(`  ✗ ${filePath} (content mismatch)`);
        mismatchCount++;
        errors.push(`${filePath}: content mismatch`);
      }
    } catch (error) {
      logError(`  ✗ ${filePath} (read error)`);
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

  // Check staging status using git.status()
  log("\nStaging status via git.status():");
  const status = await git.status().call();
  if (status.isClean()) {
    logSuccess("Staging area is clean (no uncommitted changes)");
  } else {
    log("  Staging area has changes");
  }

  // Switch back to main
  log("\nSwitching back to main branch...");
  await git.checkout().setName("main").call();
  logSuccess("Returned to main branch");

  logSuccess("Verification complete! All files match original content.");
}
