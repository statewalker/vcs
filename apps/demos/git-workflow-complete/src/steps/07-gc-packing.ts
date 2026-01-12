/**
 * Step 07: Garbage Collection & Packing
 *
 * Packs loose objects into a pack file using PackWriterStream.
 * This creates a valid Git pack file that can be read by native git.
 */

import {
  type GitRepository,
  ObjectType,
  PackWriterStream,
  writePackIndexV2,
} from "@statewalker/vcs-core";
import { bytesToHex, decompressBlock } from "@statewalker/vcs-utils";
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
  PACK_DIR,
  path,
  state,
} from "../shared/index.js";

/**
 * Read a loose object from the filesystem
 */
async function readLooseObject(
  objectId: string,
): Promise<{ type: number; content: Uint8Array } | null> {
  const prefix = objectId.substring(0, 2);
  const suffix = objectId.substring(2);
  const objectPath = path.join(OBJECTS_DIR, prefix, suffix);

  try {
    const compressed = await fs.readFile(objectPath);
    const decompressed = await decompressBlock(compressed);

    // Parse Git object format: "type size\0content"
    let nullIndex = -1;
    for (let i = 0; i < decompressed.length; i++) {
      if (decompressed[i] === 0) {
        nullIndex = i;
        break;
      }
    }

    if (nullIndex === -1) {
      return null;
    }

    // Parse header
    const header = new TextDecoder().decode(decompressed.subarray(0, nullIndex));
    const [typeName] = header.split(" ");

    // Map type name to ObjectType code
    let type: number;
    switch (typeName) {
      case "commit":
        type = ObjectType.COMMIT;
        break;
      case "tree":
        type = ObjectType.TREE;
        break;
      case "blob":
        type = ObjectType.BLOB;
        break;
      case "tag":
        type = ObjectType.TAG;
        break;
      default:
        return null;
    }

    // Content is after the null byte
    const content = decompressed.subarray(nullIndex + 1);

    return { type, content };
  } catch {
    return null;
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
    // Ignore errors
  }

  // Try to remove parent directory if empty
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
      if (prefix === "pack" || prefix === "info") continue;
      if (prefix.length !== 2) continue;

      const prefixPath = path.join(OBJECTS_DIR, prefix);
      const stat = await fs.stat(prefixPath);
      if (!stat.isDirectory()) continue;

      const suffixes = await fs.readdir(prefixPath);
      for (const suffix of suffixes) {
        if (suffix.length === 38) {
          ids.push(prefix + suffix);
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return ids;
}

export async function run(): Promise<void> {
  logSection("Step 07: Garbage Collection & Packing");

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

  // Collect loose object IDs
  const looseObjectIds = await collectLooseObjectIds();

  log("\nPacking loose objects using PackWriterStream...");

  // Create pack writer
  const packWriter = new PackWriterStream();
  let objectsWritten = 0;

  // Read and add each loose object to the pack
  for (const objectId of looseObjectIds) {
    const obj = await readLooseObject(objectId);
    if (obj) {
      await packWriter.addObject(objectId, obj.type, obj.content);
      objectsWritten++;
    }
  }

  if (objectsWritten === 0) {
    log("  No objects could be read, skipping pack creation.");
    return;
  }

  // Finalize the pack
  const result = await packWriter.finalize();

  log(`\nPack created with ${objectsWritten} objects`);

  // Generate pack filename from checksum
  const packName = `pack-${bytesToHex(result.packChecksum)}`;

  // Ensure pack directory exists
  try {
    await fs.mkdir(PACK_DIR, { recursive: true });
  } catch {
    // Directory may already exist
  }

  // Write pack file
  const packPath = path.join(PACK_DIR, `${packName}.pack`);
  await fs.writeFile(packPath, result.packData);
  log(`  Written: ${packName}.pack (${result.packData.length} bytes)`);

  // Write pack index (V2 format)
  const indexData = await writePackIndexV2(result.indexEntries, result.packChecksum);
  const indexPath = path.join(PACK_DIR, `${packName}.idx`);
  await fs.writeFile(indexPath, indexData);
  log(`  Written: ${packName}.idx (${indexData.length} bytes)`);

  // Close repository before deleting loose objects
  await repository.close();

  // Delete loose objects
  log("\nRemoving loose objects...");
  let deleted = 0;
  for (const objectId of looseObjectIds) {
    await deleteLooseObject(objectId);
    deleted++;
  }
  log(`  Deleted ${deleted} loose objects`);

  // Reopen repository
  const { createGitRepository } = await import("@statewalker/vcs-core");
  const { createFilesApi, GIT_DIR, initGitCommands } = await import("../shared/index.js");

  const files = createFilesApi();
  state.repository = (await createGitRepository(files, GIT_DIR, {
    create: false,
  })) as GitRepository;

  // Reinitialize Git commands
  const { store, git } = await initGitCommands(state.repository);
  state.store = store;
  state.git = git;

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
    logSuccess("Objects successfully packed!");
  }
}
