/**
 * Step 05: Perform Garbage Collection
 *
 * Runs garbage collection to pack loose objects into pack files.
 * Uses VCS-native garbage collection - NO NATIVE GIT.
 *
 * NOTE: This implementation uses repository.deltaStorage (RawStoreWithDelta)
 * to read objects and PendingPack to write pack files.
 *
 * GCController is designed for MAINTAINING repositories that already have
 * pack files (deltification, chain depth management, consolidation).
 * For INITIAL PACKING of loose objects, we use the lower-level APIs
 * to create a single pack file containing all objects.
 */

import { type GitRepository, PackObjectType, PendingPack, parseHeader } from "@webrun-vcs/core";
import {
  countLooseObjects,
  createFilesApi,
  fs,
  GIT_DIR,
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
 * Collect all bytes from an async iterable
 */
async function collectBytes(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for await (const chunk of stream) {
    chunks.push(chunk);
    totalLength += chunk.length;
  }

  if (chunks.length === 0) {
    return new Uint8Array(0);
  }

  if (chunks.length === 1) {
    return chunks[0];
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Convert object type code to PackObjectType
 */
function objectTypeToPackType(typeCode: number): PackObjectType {
  switch (typeCode) {
    case 1:
      return PackObjectType.COMMIT;
    case 2:
      return PackObjectType.TREE;
    case 3:
      return PackObjectType.BLOB;
    case 4:
      return PackObjectType.TAG;
    default:
      throw new Error(`Unknown object type code: ${typeCode}`);
  }
}

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

export async function run(): Promise<void> {
  logSection("Step 05: Perform Garbage Collection (VCS-native)");

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

  // Access the delta storage from the repository
  // RawStoreWithDelta provides access to both loose objects and pack files
  const deltaStorage = repository.deltaStorage;

  // Collect all objects from the storage
  log("\nCollecting objects from deltaStorage...");
  const objectIds: string[] = [];
  for await (const id of deltaStorage.keys()) {
    objectIds.push(id);
  }
  log(`  Found ${objectIds.length} objects`);

  // Create a pending pack to collect all objects into a single pack file
  const pendingPack = new PendingPack({
    maxObjects: objectIds.length + 1, // Don't auto-flush
    maxBytes: Number.MAX_SAFE_INTEGER,
  });

  // Process each object using deltaStorage.load()
  log("Reading and packing objects...");
  let processed = 0;
  for (const objectId of objectIds) {
    try {
      // Load object content via deltaStorage (handles both loose and packed objects)
      const rawContent = await collectBytes(deltaStorage.load(objectId));

      // Parse header to get type and content offset
      const header = parseHeader(rawContent);
      const content = rawContent.subarray(header.contentOffset);

      // Convert to pack object type
      const packType = objectTypeToPackType(header.typeCode);

      // Add to pending pack (content WITHOUT Git header - pack uses its own format)
      pendingPack.addObject(objectId, packType, content);

      processed++;
      if (processed % 10 === 0 || processed === objectIds.length) {
        log(`  Processed ${processed}/${objectIds.length} objects`);
      }
    } catch (error) {
      log(`  Warning: Failed to process object ${objectId}: ${(error as Error).message}`);
    }
  }

  if (pendingPack.isEmpty()) {
    log("\nNo objects to pack.");
    return;
  }

  // Flush to create a single pack file with all objects
  log("\nCreating pack file...");
  const flushResult = await pendingPack.flush();

  // Write pack file and index to filesystem
  const files = createFilesApi();
  const packPath = `${GIT_DIR}/objects/pack/${flushResult.packName}.pack`;
  const indexPath = `${GIT_DIR}/objects/pack/${flushResult.packName}.idx`;

  await files.write(packPath, [flushResult.packData]);
  await files.write(indexPath, [flushResult.indexData]);

  log(`  Created ${flushResult.packName}.pack (${flushResult.packData.length} bytes)`);
  log(`  Created ${flushResult.packName}.idx (${flushResult.indexData.length} bytes)`);

  // Delete loose objects from filesystem
  log("\nRemoving loose objects from filesystem...");
  let deleted = 0;
  for (const objectId of objectIds) {
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
    logSuccess("Objects successfully packed using VCS-native GC!");
  }
}
