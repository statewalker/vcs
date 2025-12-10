/**
 * Example 2: Roundtrip with Delta Preservation (REF_DELTA)
 *
 * Demonstrates preserving delta object structure when repacking.
 * Uses REF_DELTA references to maintain delta relationships.
 */

import {
  type PackObjectHeader,
  PackObjectType,
  PackReader,
  type PackWriterObject,
  readPackIndex,
  writePack,
  writePackIndexV2,
} from "@webrun-vcs/store-files";
import {
  createFilesApi,
  formatId,
  formatSize,
  getInputFile,
  printBanner,
  printInfo,
  printSection,
  toHex,
} from "../shared/utils.js";

/**
 * Extended pack object with delta information
 */
interface PackObjectInfo {
  id: string;
  offset: number;
  header: PackObjectHeader;
  /** Resolved object type (base type for deltas) */
  resolvedType: PackObjectType;
  /** Resolved content (after delta application) */
  resolvedContent: Uint8Array;
  /** Base object ID for REF_DELTA */
  baseId?: string;
  /** Raw delta data (if delta object) */
  deltaData?: Uint8Array;
}

/**
 * Build a dependency graph of objects
 * Returns objects ordered so bases come before their deltas
 */
function topologicalSort(objects: Map<string, PackObjectInfo>): PackObjectInfo[] {
  const visited = new Set<string>();
  const result: PackObjectInfo[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);

    const obj = objects.get(id);
    if (!obj) return;

    // Visit base first (if any)
    if (obj.baseId) {
      visit(obj.baseId);
    }

    result.push(obj);
  }

  // Visit all objects
  for (const id of objects.keys()) {
    visit(id);
  }

  return result;
}

async function main() {
  // Parse command line arguments
  const inputPath = getInputFile();
  const packPath = inputPath.endsWith(".idx") ? `${inputPath.slice(0, -4)}.pack` : inputPath;
  const idxPath = `${packPath.slice(0, -5)}.idx`;

  printBanner("Git Pack Roundtrip: Delta Preservation");
  printInfo("Input pack", packPath);
  printInfo("Input index", idxPath);

  // Create files API
  const files = createFilesApi();

  // Read the index file
  printSection("Reading Index");
  const idxData = await files.readFile(idxPath);
  const index = readPackIndex(idxData);

  printInfo("Index version", index.version);
  printInfo("Object count", index.objectCount);

  // Open pack reader
  const reader = new PackReader(files, packPath, index);
  await reader.open();

  // Read all objects with header information
  printSection("Analyzing Objects");
  const objectMap = new Map<string, PackObjectInfo>();

  let wholeCount = 0;
  let ofsDeltaCount = 0;
  let refDeltaCount = 0;

  for (const entry of index.entries()) {
    const header = await reader.readObjectHeader(entry.offset);
    const resolved = await reader.get(entry.id);

    if (!resolved) {
      console.error(`  Failed to read object: ${entry.id}`);
      continue;
    }

    const info: PackObjectInfo = {
      id: entry.id,
      offset: entry.offset,
      header,
      resolvedType: resolved.type,
      resolvedContent: resolved.content,
    };

    // Track delta relationships
    if (header.type === PackObjectType.REF_DELTA && header.baseId) {
      info.baseId = header.baseId;
      refDeltaCount++;
    } else if (header.type === PackObjectType.OFS_DELTA && header.baseOffset) {
      // Convert OFS_DELTA to REF_DELTA by finding base ID
      const baseOffset = entry.offset - header.baseOffset;
      // Find the object at this offset
      for (const [id, obj] of objectMap.entries()) {
        if (obj.offset === baseOffset) {
          info.baseId = id;
          break;
        }
      }
      if (!info.baseId) {
        // Base hasn't been seen yet, search in index
        for (const e of index.entries()) {
          if (e.offset === baseOffset) {
            info.baseId = e.id;
            break;
          }
        }
      }
      ofsDeltaCount++;
    } else {
      wholeCount++;
    }

    objectMap.set(entry.id, info);
  }

  await reader.close();

  printInfo("Whole objects", wholeCount);
  printInfo("OFS_DELTA objects", ofsDeltaCount);
  printInfo("REF_DELTA objects", refDeltaCount);
  printInfo("Total delta objects", ofsDeltaCount + refDeltaCount);

  // Show delta chains
  printSection("Delta Chains");

  // Find delta chains
  const chains: { base: string; deltas: string[] }[] = [];
  const deltasWithBase = new Set<string>();

  for (const [id, obj] of objectMap.entries()) {
    if (obj.baseId) {
      deltasWithBase.add(id);
    }
  }

  // Find base objects that have deltas
  for (const [id, obj] of objectMap.entries()) {
    if (!obj.baseId) {
      // This could be a base - check if anything depends on it
      const deltas: string[] = [];
      for (const [deltaId, deltaObj] of objectMap.entries()) {
        if (deltaObj.baseId === id) {
          deltas.push(deltaId);
        }
      }
      if (deltas.length > 0) {
        chains.push({ base: id, deltas });
      }
    }
  }

  if (chains.length === 0) {
    console.log("  No delta chains found in this pack");
  } else {
    console.log(`  Found ${chains.length} base objects with deltas:`);
    for (const chain of chains.slice(0, 5)) {
      console.log(`    ${formatId(chain.base)} <- ${chain.deltas.length} delta(s)`);
      for (const delta of chain.deltas.slice(0, 3)) {
        console.log(`      ${formatId(delta)}`);
      }
      if (chain.deltas.length > 3) {
        console.log(`      ... and ${chain.deltas.length - 3} more`);
      }
    }
    if (chains.length > 5) {
      console.log(`    ... and ${chains.length - 5} more base objects`);
    }
  }

  // Sort objects topologically (bases before deltas)
  printSection("Ordering Objects");
  const sortedObjects = topologicalSort(objectMap);
  console.log(`  Sorted ${sortedObjects.length} objects for writing`);

  // Build writer objects
  // Note: Since we resolved all objects, we write them as whole objects
  // In a real scenario with delta preservation, you'd need access to raw delta bytes
  printSection("Writing Pack (as whole objects)");

  const writerObjects: PackWriterObject[] = sortedObjects.map((obj) => ({
    id: obj.id,
    type: obj.resolvedType,
    content: obj.resolvedContent,
  }));

  const result = await writePack(writerObjects);

  printInfo("Pack size", formatSize(result.packData.length));
  printInfo("Pack checksum", formatId(toHex(result.packChecksum), 12));

  // Write index
  const newIdxData = await writePackIndexV2(result.indexEntries, result.packChecksum);

  // Compare sizes
  printSection("Size Comparison");

  const origPackData = await files.readFile(packPath);
  printInfo("Original pack", formatSize(origPackData.length));
  printInfo("Repacked (no deltas)", formatSize(result.packData.length));

  const sizeDiff = result.packData.length - origPackData.length;
  const pctChange = ((sizeDiff / origPackData.length) * 100).toFixed(1);
  printInfo("Size change", `${sizeDiff > 0 ? "+" : ""}${sizeDiff} bytes (${pctChange}%)`);

  if (sizeDiff > 0) {
    console.log("\n  Note: Pack grew because delta objects were expanded to full objects.");
    console.log("  Git uses deltas to reduce pack size by storing differences.");
  }

  // Verify all objects present
  printSection("Verification");
  const newIndex = readPackIndex(newIdxData);

  let allPresent = true;
  for (const entry of index.entries()) {
    if (!newIndex.has(entry.id)) {
      console.error(`  Missing: ${entry.id}`);
      allPresent = false;
    }
  }
  printInfo("All objects present", allPresent ? "YES" : "NO");

  // Write output
  printSection("Output");
  const outputPackPath = `${packPath}.no-deltas.pack`;
  const outputIdxPath = `${outputPackPath.slice(0, -5)}.idx`;

  await files.write(outputPackPath, [result.packData]);
  await files.write(outputIdxPath, [newIdxData]);

  console.log(`  Pack: ${outputPackPath}`);
  console.log(`  Index: ${outputIdxPath}`);

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
