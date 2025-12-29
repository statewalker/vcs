/**
 * Step 05: Perform Garbage Collection
 *
 * Runs garbage collection to pack loose objects into pack files.
 * Uses GCController for VCS-native garbage collection - NO NATIVE GIT.
 *
 * GCController handles:
 * - Collecting all loose objects
 * - Packing them into a single pack file
 * - Deltifying objects for compression
 * - Managing delta chains
 */

import { GCController, type GitRepository, type PackingProgress } from "@webrun-vcs/core";
import {
  countLooseObjects,
  fs,
  getPackFileStats,
  listPackFiles,
  log,
  logInfo,
  logSection,
  logSuccess,
  OBJECTS_DIR,
  path,
  state,
} from "../shared/index.js";

/**
 * Delete loose object from filesystem
 */
async function deleteLooseObject(objectId: string): Promise<void> {
  const prefix = objectId.substring(0, 2);
  const suffix = objectId.substring(2);
  const objectPath = path.join(OBJECTS_DIR, prefix, suffix);

  try {
    await fs.unlink(objectPath);
  } catch {
    // Ignore errors - object may already be deleted
  }

  // Try to remove the parent directory if empty
  try {
    const parentDir = path.join(OBJECTS_DIR, prefix);
    const remaining = await fs.readdir(parentDir);
    if (remaining.length === 0) {
      await fs.rmdir(parentDir);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Collect all loose object IDs from filesystem
 */
async function collectLooseObjectIds(): Promise<string[]> {
  const ids: string[] = [];

  try {
    const prefixes = await fs.readdir(OBJECTS_DIR);
    for (const prefix of prefixes) {
      // Skip pack directory and info directory
      if (prefix === "pack" || prefix === "info") continue;
      // Valid prefix is 2 hex characters
      if (prefix.length !== 2) continue;

      const prefixPath = path.join(OBJECTS_DIR, prefix);
      const stat = await fs.stat(prefixPath);
      if (!stat.isDirectory()) continue;

      const suffixes = await fs.readdir(prefixPath);
      for (const suffix of suffixes) {
        // Valid object ID suffix is 38 hex characters
        if (suffix.length === 38) {
          ids.push(prefix + suffix);
        }
      }
    }
  } catch {
    // Ignore errors - directory may not exist
  }

  return ids;
}

export async function run(): Promise<void> {
  logSection("Step 05: Perform Garbage Collection (GCController)");

  const repository = state.repository as GitRepository | undefined;
  if (!repository) {
    throw new Error("Repository not initialized. Run step 01 first.");
  }

  // Get counts before GC
  const { count: looseBefore } = await countLooseObjects();
  const packsBefore = await listPackFiles();

  log("State before GC:");
  logInfo("  Loose objects", looseBefore);
  logInfo("  Pack files", packsBefore.length);

  if (looseBefore === 0) {
    log("\nNo loose objects to pack.");
    return;
  }

  // Collect loose object IDs before GC (for cleanup)
  const looseObjectIds = await collectLooseObjectIds();

  // Create GC controller with the delta storage
  const gc = new GCController(repository.deltaStorage, {
    looseObjectThreshold: 1, // Always run
    minInterval: 0, // No minimum interval
  });

  // Progress callback for logging
  const progressCallback = (progress: PackingProgress): void => {
    if (progress.phase === "deltifying") {
      if (
        progress.processedObjects % 10 === 0 ||
        progress.processedObjects === progress.totalObjects
      ) {
        log(`  Processing ${progress.processedObjects}/${progress.totalObjects} objects`);
      }
    } else if (progress.phase === "complete") {
      log(`  Deltified ${progress.deltifiedObjects} objects`);
      if (progress.bytesSaved > 0) {
        log(`  Space saved: ${progress.bytesSaved} bytes`);
      }
    }
  };

  // Run GC with progress reporting
  log("\nRunning GC...");
  const result = await gc.runGC({
    progressCallback,
    pruneLoose: false, // We'll delete loose objects ourselves for cleaner control
    windowSize: 10, // Enable deltification with sliding window
  });

  log(`\nGC completed in ${result.duration}ms:`);
  logInfo("  Objects processed", result.objectsProcessed);
  logInfo("  Deltas created", result.deltasCreated);

  // Delete loose objects from filesystem
  // (GCController writes to pack, we delete the originals)
  log("\nRemoving loose objects from filesystem...");
  let deleted = 0;
  for (const objectId of looseObjectIds) {
    await deleteLooseObject(objectId);
    deleted++;
  }
  log(`  Deleted ${deleted} loose objects`);

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

  // Calculate compression
  if (looseBefore > 0 && looseAfter < looseBefore) {
    const reduction = ((looseBefore - looseAfter) / looseBefore) * 100;
    logSuccess(`Reduced loose objects by ${reduction.toFixed(1)}%`);
  }

  if (packsAfter.length > 0) {
    logSuccess("Objects successfully packed using GCController!");
  }
}
