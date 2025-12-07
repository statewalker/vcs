/**
 * Example 1: Simple Pack File Roundtrip
 *
 * Demonstrates reading a Git pack file and writing it back.
 * This is the basic workflow for working with pack files.
 */

import {
  PackReader,
  type PackWriterObject,
  readPackIndex,
  writePack,
  writePackIndexV2,
} from "@webrun-vcs/storage-git";
import {
  compareBytes,
  createFilesApi,
  formatId,
  formatSize,
  getInputFile,
  getTypeName,
  printBanner,
  printInfo,
  printSection,
  toHex,
} from "../shared/utils.js";

async function main() {
  // Parse command line arguments
  const inputPath = getInputFile();
  const packPath = inputPath.endsWith(".idx") ? `${inputPath.slice(0, -4)}.pack` : inputPath;
  const idxPath = `${packPath.slice(0, -5)}.idx`;

  printBanner("Git Pack Roundtrip: Simple");
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
  printInfo("CRC32 support", index.hasCRC32Support());
  printInfo("64-bit offsets", index.offset64Count);
  printInfo("Pack checksum", formatId(toHex(index.packChecksum), 12));

  // Open pack reader
  printSection("Opening Pack Reader");
  const reader = new PackReader(files, packPath, index);
  await reader.open();

  const header = await reader.readPackHeader();
  printInfo("Pack version", header.version);
  printInfo("Pack objects", header.objectCount);

  // Collect all objects
  printSection("Reading Objects");
  const objects: PackWriterObject[] = [];
  let count = 0;

  for (const entry of index.entries()) {
    count++;
    const obj = await reader.get(entry.id);
    if (!obj) {
      console.error(`  Failed to read object: ${entry.id}`);
      continue;
    }

    objects.push({
      id: entry.id,
      type: obj.type,
      content: obj.content,
    });

    // Progress output
    if (count <= 10 || count === index.objectCount) {
      console.log(
        `  [${count}/${index.objectCount}] ${formatId(entry.id)} ${getTypeName(obj.type)} (${formatSize(obj.size)})`,
      );
    } else if (count === 11) {
      console.log(`  ... (showing first 10 and last object)`);
    }
  }

  await reader.close();
  console.log(`\n  Total: ${objects.length} objects collected`);

  // Write pack file
  printSection("Writing Pack");
  const result = await writePack(objects);

  printInfo("Added objects", objects.length);
  printInfo("Pack size", formatSize(result.packData.length));
  printInfo("Pack checksum", formatId(toHex(result.packChecksum), 12));

  // Write index file
  printSection("Writing Index");
  const newIdxData = await writePackIndexV2(result.indexEntries, result.packChecksum);
  printInfo("Index size", formatSize(newIdxData.length));

  // Compare with original
  printSection("Verification");

  const origPackData = await files.readFile(packPath);
  const packComparison = compareBytes(origPackData, result.packData);

  printInfo("Original pack size", formatSize(origPackData.length));
  printInfo("Repacked size", formatSize(result.packData.length));
  printInfo("Size difference", `${packComparison.sizeDiff} bytes`);
  printInfo("Packs identical", packComparison.equal ? "YES" : "NO");

  if (!packComparison.equal) {
    console.log("\n  Note: Repacked files may differ due to:");
    console.log("    - Different compression levels");
    console.log("    - Delta objects resolved to base types");
    console.log("    - Object ordering differences");
  }

  // Verify objects are logically equivalent
  printSection("Object Verification");

  // Parse the new index
  const newIndex = readPackIndex(newIdxData);
  printInfo("New index version", newIndex.version);
  printInfo("New object count", newIndex.objectCount);

  // Check all object IDs are present
  let matchCount = 0;
  for (const entry of index.entries()) {
    if (newIndex.has(entry.id)) {
      matchCount++;
    } else {
      console.error(`  Missing object: ${entry.id}`);
    }
  }

  printInfo("Objects matched", `${matchCount}/${index.objectCount}`);
  printInfo("All objects present", matchCount === index.objectCount ? "YES" : "NO");

  // Write output files
  printSection("Output");
  const outputPackPath = `${packPath}.repacked`;
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
