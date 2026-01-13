/**
 * Step 07: Garbage Collection & Packing
 *
 * Demonstrates repository maintenance using git.gc() porcelain command.
 * This command packs refs for more efficient storage.
 */

import {
  countLooseObjects,
  getPackFileStats,
  listPackFiles,
  log,
  logInfo,
  logSection,
  logSuccess,
  state,
} from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 07: Garbage Collection & Packing");

  const { git } = state;
  if (!git) {
    throw new Error("Repository not initialized. Run step 01 first.");
  }

  // Get counts before GC
  const { count: looseBefore } = await countLooseObjects();
  const packsBefore = await listPackFiles();

  log("State before GC:");
  logInfo("  Loose objects", looseBefore);
  logInfo("  Pack files", packsBefore.length);

  // Run garbage collection using git.gc()
  log("\nRunning git.gc()...");
  const gcResult = await git.gc().setPackRefs(true).call();

  log(`\nGC completed in ${gcResult.durationMs}ms`);
  logInfo("  Refs packed", gcResult.refsPacked ? "yes" : "no");
  logInfo("  Objects removed", gcResult.objectsRemoved);

  // Get counts after GC
  const { count: looseAfter } = await countLooseObjects();
  const packsAfter = await listPackFiles();
  const packStats = await getPackFileStats();

  log("\nState after GC:");
  logInfo("  Loose objects", looseAfter);
  logInfo("  Pack files", packsAfter.length);

  if (packStats.length > 0) {
    log("\n  Pack file details:");
    for (const pack of packStats) {
      log(`    ${pack.name} (${pack.sizeFormatted})`);
    }
  }

  // Note about full GC
  log("\nNote: git.gc() currently focuses on packing refs.");
  log("Full object packing requires native git or extended GCController.");

  logSuccess("GC operations complete!");
}
