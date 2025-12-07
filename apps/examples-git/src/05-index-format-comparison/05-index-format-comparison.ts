/**
 * Example 5: Index Format Comparison (V1 vs V2)
 *
 * Demonstrates differences between pack index format versions.
 */

import {
  type PackIndexWriterEntry,
  readPackIndex,
  writePackIndexV1,
  writePackIndexV2,
} from "@webrun-vcs/storage-git";
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
 * Calculate expected V1 index size
 * Format: Fanout(256×4) + Entries(N×24) + PackChecksum(20) + IndexChecksum(20)
 */
function calculateV1Size(objectCount: number): number {
  const fanoutSize = 256 * 4;
  const entriesSize = objectCount * (4 + 20); // offset + object ID
  const checksumSize = 20 * 2; // pack + index checksums
  return fanoutSize + entriesSize + checksumSize;
}

/**
 * Calculate expected V2 index size
 * Format: Header(8) + Fanout(256×4) + IDs(N×20) + CRCs(N×4) + Offsets(N×4) + [64-bit offsets] + Checksums(40)
 */
function calculateV2Size(objectCount: number, offset64Count: number): number {
  const headerSize = 8;
  const fanoutSize = 256 * 4;
  const idsSize = objectCount * 20;
  const crc32Size = objectCount * 4;
  const offset32Size = objectCount * 4;
  const offset64Size = offset64Count * 8;
  const checksumSize = 20 * 2;
  return headerSize + fanoutSize + idsSize + crc32Size + offset32Size + offset64Size + checksumSize;
}

async function main() {
  // Parse command line arguments
  const inputPath = getInputFile();
  const idxPath = inputPath.endsWith(".pack") ? `${inputPath.slice(0, -5)}.idx` : inputPath;

  printBanner("Git Pack Index: Format Comparison");
  printInfo("Input index", idxPath);

  // Create files API
  const files = createFilesApi();

  // Read the original index
  printSection("Reading Original Index");
  const origIdxData = await files.readFile(idxPath);
  const origIndex = readPackIndex(origIdxData);

  printInfo("File size", formatSize(origIdxData.length));
  printInfo("Version", origIndex.version);
  printInfo("Object count", origIndex.objectCount);
  printInfo("CRC32 support", origIndex.hasCRC32Support());
  printInfo("64-bit offsets", origIndex.offset64Count);
  printInfo("Pack checksum", formatId(toHex(origIndex.packChecksum), 12));

  // Detect version from first bytes
  const hasV2Magic =
    origIdxData[0] === 0xff &&
    origIdxData[1] === 0x74 &&
    origIdxData[2] === 0x4f &&
    origIdxData[3] === 0x63;
  printInfo("Detected format", hasV2Magic ? "V2 (with magic)" : "V1 (legacy)");

  // Extract entries for writing
  printSection("Extracting Entries");
  const entries: PackIndexWriterEntry[] = [];
  let maxOffset = 0;

  for (const entry of origIndex.entries()) {
    entries.push({
      id: entry.id,
      offset: entry.offset,
      crc32: entry.crc32 ?? 0,
    });
    maxOffset = Math.max(maxOffset, entry.offset);
  }

  // Sort by object ID (required for index files)
  entries.sort((a, b) => a.id.localeCompare(b.id));

  printInfo("Entries extracted", entries.length);
  printInfo("Max offset", maxOffset);
  printInfo("Needs 64-bit offsets", maxOffset > 0x7fffffff ? "YES" : "NO");

  // Display some entries
  console.log("\n  Sample entries (first 5):");
  for (const entry of entries.slice(0, 5)) {
    console.log(
      `    ${formatId(entry.id)} offset=${entry.offset} crc32=${entry.crc32.toString(16).padStart(8, "0")}`,
    );
  }

  // Write V1 index
  printSection("Writing V1 Index");
  const v1IdxData = await writePackIndexV1(entries, origIndex.packChecksum);

  const expectedV1Size = calculateV1Size(entries.length);
  printInfo("Actual size", formatSize(v1IdxData.length));
  printInfo("Expected size", formatSize(expectedV1Size));
  printInfo("Size matches", v1IdxData.length === expectedV1Size ? "YES" : "NO");

  // V1 structure breakdown
  console.log("\n  V1 Structure:");
  console.log(`    Fanout table:    ${256 * 4} bytes`);
  console.log(`    Entries:         ${entries.length * 24} bytes (${entries.length} × 24)`);
  console.log(`    Pack checksum:   20 bytes`);
  console.log(`    Index checksum:  20 bytes`);
  console.log(`    Total:           ${v1IdxData.length} bytes`);

  // Write V2 index
  printSection("Writing V2 Index");
  const v2IdxData = await writePackIndexV2(entries, origIndex.packChecksum);

  const expectedV2Size = calculateV2Size(entries.length, origIndex.offset64Count);
  printInfo("Actual size", formatSize(v2IdxData.length));
  printInfo("Expected size", formatSize(expectedV2Size));
  printInfo("Size matches", v2IdxData.length === expectedV2Size ? "YES" : "NO");

  // V2 structure breakdown
  console.log("\n  V2 Structure:");
  console.log(`    Magic + version: 8 bytes`);
  console.log(`    Fanout table:    ${256 * 4} bytes`);
  console.log(`    Object IDs:      ${entries.length * 20} bytes (${entries.length} × 20)`);
  console.log(`    CRC32 values:    ${entries.length * 4} bytes (${entries.length} × 4)`);
  console.log(`    32-bit offsets:  ${entries.length * 4} bytes (${entries.length} × 4)`);
  if (origIndex.offset64Count > 0) {
    console.log(`    64-bit offsets:  ${origIndex.offset64Count * 8} bytes`);
  }
  console.log(`    Pack checksum:   20 bytes`);
  console.log(`    Index checksum:  20 bytes`);
  console.log(`    Total:           ${v2IdxData.length} bytes`);

  // Size comparison
  printSection("Size Comparison");

  const sizeDiff = v2IdxData.length - v1IdxData.length;
  const pctDiff = ((sizeDiff / v1IdxData.length) * 100).toFixed(1);

  console.log("\n  Format | Size     | Per Object");
  console.log("  -------|----------|------------");
  console.log(
    `  V1     | ${formatSize(v1IdxData.length).padStart(8)} | ${(v1IdxData.length / entries.length).toFixed(1)} bytes`,
  );
  console.log(
    `  V2     | ${formatSize(v2IdxData.length).padStart(8)} | ${(v2IdxData.length / entries.length).toFixed(1)} bytes`,
  );
  console.log(`  Diff   | ${sizeDiff > 0 ? "+" : ""}${sizeDiff} bytes | ${pctDiff}%`);

  // Feature comparison
  printSection("Feature Comparison");

  console.log("\n  Feature              | V1    | V2");
  console.log("  ---------------------|-------|-------");
  console.log("  CRC32 per object     | No    | Yes");
  console.log("  64-bit offset support| No    | Yes");
  console.log("  Max pack size        | 4 GB  | >4 GB");
  console.log("  Object lookup        | O(log n) | O(log n)");
  console.log("  Binary search        | In entries | In IDs");

  // Verify both formats can be read back
  printSection("Verification");

  const v1Index = readPackIndex(v1IdxData);
  const v2Index = readPackIndex(v2IdxData);

  console.log("\n  V1 roundtrip:");
  printInfo("Version", v1Index.version);
  printInfo("Object count", v1Index.objectCount);
  printInfo("CRC32 support", v1Index.hasCRC32Support());

  console.log("\n  V2 roundtrip:");
  printInfo("Version", v2Index.version);
  printInfo("Object count", v2Index.objectCount);
  printInfo("CRC32 support", v2Index.hasCRC32Support());

  // Verify all objects can be found
  let v1Matches = 0;
  let v2Matches = 0;
  let crc32Matches = 0;

  for (const entry of entries) {
    if (v1Index.findOffset(entry.id) === entry.offset) v1Matches++;
    if (v2Index.findOffset(entry.id) === entry.offset) v2Matches++;

    const v2Crc = v2Index.findCRC32(entry.id);
    if (v2Crc === entry.crc32) crc32Matches++;
  }

  printInfo("V1 offset matches", `${v1Matches}/${entries.length}`);
  printInfo("V2 offset matches", `${v2Matches}/${entries.length}`);
  printInfo("V2 CRC32 matches", `${crc32Matches}/${entries.length}`);

  // Write output files
  printSection("Output");
  const basePath = idxPath.replace(/\.idx$/, "");

  const v1Path = `${basePath}.v1.idx`;
  const v2Path = `${basePath}.v2.idx`;

  await files.write(v1Path, [v1IdxData]);
  await files.write(v2Path, [v2IdxData]);

  console.log(`  V1 index: ${v1Path}`);
  console.log(`  V2 index: ${v2Path}`);

  // Practical recommendations
  printSection("Recommendations");
  console.log(`
  Use V1 when:
    - Maximum compatibility needed
    - Pack files < 4 GB
    - CRC32 validation not required

  Use V2 when:
    - Pack files may exceed 2 GB
    - CRC32 integrity checking desired
    - Modern Git tooling (2005+)

  Note: Git has used V2 by default since 2006.
  V1 is considered legacy and rarely used today.
  `);

  console.log("Done!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
