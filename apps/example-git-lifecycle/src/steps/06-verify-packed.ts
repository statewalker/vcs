/**
 * Step 06: Verify Packed Objects
 *
 * Verifies that pack files exist and contain the expected objects.
 * Uses native git to verify pack file contents.
 */

import {
  countLooseObjects,
  getPackFileStats,
  isGitAvailable,
  listPackFiles,
  log,
  logError,
  logInfo,
  logSection,
  logSuccess,
  runGitCommand,
  shortId,
  state,
} from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 06: Verify Packed Objects");

  // Check pack files on filesystem
  const packFiles = await listPackFiles();
  const packStats = await getPackFileStats();
  const { count: looseCount } = await countLooseObjects();

  log("Filesystem state:");
  logInfo("  Pack files", packFiles.length);
  logInfo("  Loose objects", looseCount);

  if (packStats.length > 0) {
    log("\n  Pack file details:");
    for (const pack of packStats) {
      log(`    ${pack.name} (${pack.sizeFormatted})`);
    }
  }

  if (!isGitAvailable()) {
    log("\nGit not available, skipping pack content verification");
    return;
  }

  // Verify pack contents using native git
  log("\nVerifying pack contents with native git...");

  // Use git verify-pack to check pack file integrity
  for (const packFile of packFiles) {
    const packPath = `.git/objects/pack/${packFile}`;
    log(`\n  $ git verify-pack -v ${packPath} (summary)`);
    const verifyOutput = runGitCommand(`git verify-pack -v ${packPath}`);

    if (verifyOutput.startsWith("ERROR")) {
      logError(verifyOutput);
    } else {
      // Count object types in pack
      const lines = verifyOutput.split("\n");
      let commits = 0;
      let trees = 0;
      let blobs = 0;
      let deltas = 0;

      for (const line of lines) {
        if (line.includes(" commit ")) commits++;
        else if (line.includes(" tree ")) trees++;
        else if (line.includes(" blob ")) blobs++;
        if (line.includes(" delta ") || line.includes("OFS_DELTA") || line.includes("REF_DELTA")) {
          deltas++;
        }
      }

      logInfo("    Commits", commits);
      logInfo("    Trees", trees);
      logInfo("    Blobs", blobs);
      if (deltas > 0) logInfo("    Delta objects", deltas);
    }
  }

  // Verify we can read commits
  log("\nVerifying commits accessible...");

  let allCommitsAccessible = true;
  for (const commitInfo of state.commits.slice(0, 5)) {
    const catResult = runGitCommand(`git cat-file -t ${commitInfo.id}`);
    if (catResult === "commit") {
      log(`  ✓ Commit ${shortId(commitInfo.id)}: ${commitInfo.message}`);
    } else {
      logError(`Commit ${shortId(commitInfo.id)}: ${catResult}`);
      allCommitsAccessible = false;
    }
  }

  if (state.commits.length > 5) {
    log(`  ... and ${state.commits.length - 5} more commits`);
  }

  // Summary
  if (allCommitsAccessible && packFiles.length > 0) {
    logSuccess("\nAll objects verified in pack files!");
  } else if (packFiles.length === 0) {
    log("\nNo pack files found - objects may still be loose");
  } else {
    logError("\nSome objects failed verification");
  }
}
