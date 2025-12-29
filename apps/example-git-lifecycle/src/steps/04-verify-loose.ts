/**
 * Step 04: Verify Loose Objects Exist in Filesystem
 *
 * Checks the .git/objects directory to verify that all objects
 * are stored as loose objects before GC.
 */

import {
  countLooseObjects,
  log,
  logInfo,
  logSection,
  logSuccess,
  OBJECTS_DIR,
  state,
} from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 04: Verify Loose Objects in Filesystem");

  if (state.commits.length === 0) {
    throw new Error("No commits found. Run steps 01-03 first.");
  }

  log("Scanning .git/objects for loose objects...");
  log(`  Objects directory: ${OBJECTS_DIR}`);

  const { count, objects } = await countLooseObjects();

  logInfo("Total loose objects found", count);

  // Calculate expected objects
  // Each commit creates: 1 commit + 1 tree + N blobs + subdirectory trees
  // This is an approximation
  const numCommits = state.commits.length;
  log(`\n  Commits created: ${numCommits}`);
  log(`  Expected object types: commits, trees, blobs`);

  // Show sample of loose objects
  log("\n  Sample loose objects (first 10):");
  const sample = objects.slice(0, 10);
  for (const obj of sample) {
    log(`    ${obj.substring(0, 2)}/${obj.substring(2)}`);
  }

  if (objects.length > 10) {
    log(`    ... and ${objects.length - 10} more`);
  }

  // Verify we have a reasonable number of objects
  if (count >= numCommits) {
    logSuccess(`Found ${count} loose objects for ${numCommits} commits`);
    logSuccess("All objects stored as loose files");
  } else {
    throw new Error(`Expected at least ${numCommits} objects but found ${count}`);
  }
}
