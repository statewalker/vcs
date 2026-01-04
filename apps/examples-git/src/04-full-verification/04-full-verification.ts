/**
 * Example 4: Full Roundtrip with Verification
 *
 * Demonstrates complete roundtrip with detailed logging,
 * content preview, and byte-level comparison.
 */

import {
  PackObjectType,
  PackReader,
  type PackWriterObject,
  parseTreeToArray,
  readPackIndex,
  writePack,
  writePackIndexV2,
} from "@statewalker/vcs-core";
import {
  compareBytes,
  createFilesApi,
  decodeText,
  formatId,
  formatSize,
  getContentPreview,
  getInputFile,
  getTypeName,
  isTextContent,
  printBanner,
  printInfo,
  printSection,
  toHex,
} from "../shared/utils.js";

/**
 * Parse and format tree entries
 */
function formatTreeEntries(content: Uint8Array): string {
  try {
    const entries = parseTreeToArray(content);
    const lines = entries.slice(0, 5).map((e) => {
      const modeStr = e.mode.toString(8).padStart(6, "0");
      const typeHint = e.mode === 0o40000 ? "tree" : e.mode === 0o160000 ? "commit" : "blob";
      return `      ${modeStr} ${typeHint} ${formatId(e.id)} ${e.name}`;
    });
    if (entries.length > 5) {
      lines.push(`      ... and ${entries.length - 5} more entries`);
    }
    return lines.join("\n");
  } catch {
    return "      (failed to parse tree)";
  }
}

/**
 * Format commit content for display
 */
function formatCommit(content: Uint8Array): string {
  const text = decodeText(content);
  const lines = text.split("\n");

  const result: string[] = [];
  let inHeaders = true;

  for (const line of lines.slice(0, 10)) {
    if (inHeaders && line === "") {
      inHeaders = false;
      result.push("      ---");
    } else if (inHeaders) {
      const [key, ...rest] = line.split(" ");
      const value = rest.join(" ");
      if (key === "tree" || key === "parent") {
        result.push(`      ${key}: ${formatId(value)}`);
      } else if (key === "author" || key === "committer") {
        // Extract name and email
        const match = value.match(/^(.+?) <(.+?)>/);
        if (match) {
          result.push(`      ${key}: ${match[1]}`);
        }
      }
    } else {
      // Message body
      result.push(`      ${line.substring(0, 60)}${line.length > 60 ? "..." : ""}`);
    }
  }

  return result.join("\n");
}

/**
 * Format object content for display
 */
function formatObjectContent(type: PackObjectType, content: Uint8Array): string {
  switch (type) {
    case PackObjectType.TREE:
      return formatTreeEntries(content);
    case PackObjectType.COMMIT:
      return formatCommit(content);
    case PackObjectType.TAG: {
      const text = decodeText(content);
      const preview = text.split("\n").slice(0, 6).join("\n      ");
      return `      ${preview}`;
    }
    case PackObjectType.BLOB:
      if (isTextContent(content)) {
        return `      ${getContentPreview(content, 100).replace(/\n/g, "\n      ")}`;
      }
      return `      (binary data: ${formatSize(content.length)})`;
    default:
      return `      (unknown type ${type})`;
  }
}

async function main() {
  // Parse command line arguments
  const inputPath = getInputFile();
  const packPath = inputPath.endsWith(".idx") ? `${inputPath.slice(0, -4)}.pack` : inputPath;
  const idxPath = `${packPath.slice(0, -5)}.idx`;

  printBanner("Git Pack Roundtrip: Full Verification");
  printInfo("Input pack", packPath);
  printInfo("Input index", idxPath);

  // Create files API
  const files = createFilesApi();

  // Read and display pack header
  printSection("Pack File Header");
  const packData = await files.readFile(packPath);
  printInfo("File size", formatSize(packData.length));

  // Parse magic
  const magic = decodeText(packData.subarray(0, 4));
  printInfo("Magic", magic);

  // Version
  const version =
    ((packData[4] << 24) | (packData[5] << 16) | (packData[6] << 8) | packData[7]) >>> 0;
  printInfo("Version", version);

  // Object count
  const objectCount =
    ((packData[8] << 24) | (packData[9] << 16) | (packData[10] << 8) | packData[11]) >>> 0;
  printInfo("Object count", objectCount);

  // Trailing checksum
  const storedChecksum = packData.subarray(packData.length - 20);
  printInfo("Stored checksum", formatId(toHex(storedChecksum), 12));

  // Read and display index header
  printSection("Index File Header");
  const idxData = await files.readFile(idxPath);
  const index = readPackIndex(idxData);

  printInfo("Index version", index.version);
  printInfo("Object count", index.objectCount);
  printInfo("CRC32 support", index.hasCRC32Support());
  printInfo("64-bit offsets", index.offset64Count);
  printInfo("Pack checksum", formatId(toHex(index.packChecksum), 12));
  printInfo("Index checksum", formatId(toHex(index.indexChecksum), 12));

  // Verify pack checksum matches index
  const checksumMatch = toHex(storedChecksum) === toHex(index.packChecksum);
  printInfo("Checksums match", checksumMatch ? "YES" : "NO");

  // Open pack reader
  const reader = new PackReader(files, packPath, index);
  await reader.open();

  // Read and display objects
  printSection("Objects");

  const objects: PackWriterObject[] = [];
  const typeCounts = new Map<PackObjectType, number>();
  let totalSize = 0;
  let count = 0;

  for (const entry of index.entries()) {
    count++;
    const header = await reader.readObjectHeader(entry.offset);
    const obj = await reader.get(entry.id);

    if (!obj) {
      console.error(`  Failed to read: ${entry.id}`);
      continue;
    }

    objects.push({
      id: entry.id,
      type: obj.type,
      content: obj.content,
    });

    typeCounts.set(obj.type, (typeCounts.get(obj.type) ?? 0) + 1);
    totalSize += obj.size;

    // Display first few objects in detail
    if (count <= 5) {
      console.log(`\n  Object ${count}: ${formatId(entry.id)}`);
      console.log(`    Type: ${getTypeName(obj.type)} (stored as ${getTypeName(header.type)})`);
      console.log(`    Size: ${formatSize(obj.size)}`);
      console.log(`    Offset: ${entry.offset}`);
      if (entry.crc32 !== undefined) {
        console.log(`    CRC32: ${entry.crc32.toString(16).padStart(8, "0")}`);
      }
      if (header.baseId) {
        console.log(`    Base: ${formatId(header.baseId)} (REF_DELTA)`);
      }
      if (header.baseOffset) {
        console.log(`    Base offset: -${header.baseOffset} (OFS_DELTA)`);
      }
      console.log(`    Content:`);
      console.log(formatObjectContent(obj.type, obj.content));
    }
  }

  await reader.close();

  if (count > 5) {
    console.log(`\n  ... and ${count - 5} more objects`);
  }

  // Summary
  printSection("Object Summary");
  for (const [type, typeCount] of typeCounts) {
    console.log(`  ${getTypeName(type).padEnd(10)} ${typeCount.toString().padStart(4)} objects`);
  }
  printInfo("Total objects", count);
  printInfo("Total content size", formatSize(totalSize));

  // Write new pack
  printSection("Writing New Pack");
  const result = await writePack(objects);

  printInfo("Pack size", formatSize(result.packData.length));
  printInfo("Pack checksum", formatId(toHex(result.packChecksum), 12));

  // Write new index
  const newIdxData = await writePackIndexV2(result.indexEntries, result.packChecksum);
  printInfo("Index size", formatSize(newIdxData.length));

  // Byte-level comparison
  printSection("Byte-Level Comparison");

  console.log("\n  Pack file:");
  const packCmp = compareBytes(packData, result.packData);
  printInfo("Original size", formatSize(packData.length));
  printInfo("New size", formatSize(result.packData.length));
  printInfo("Size difference", `${packCmp.sizeDiff} bytes`);
  printInfo("Identical", packCmp.equal ? "YES" : "NO");

  if (!packCmp.equal && packCmp.firstMismatchIndex >= 0) {
    printInfo("First mismatch at", packCmp.firstMismatchIndex);
    printInfo("Mismatch count", packCmp.mismatchCount);
  }

  console.log("\n  Index file:");
  const idxCmp = compareBytes(idxData, newIdxData);
  printInfo("Original size", formatSize(idxData.length));
  printInfo("New size", formatSize(newIdxData.length));
  printInfo("Size difference", `${idxCmp.sizeDiff} bytes`);
  printInfo("Identical", idxCmp.equal ? "YES" : "NO");

  // Verify logical equivalence
  printSection("Logical Verification");

  // Parse new index and verify all objects
  const newIndex = readPackIndex(newIdxData);

  let allObjectsMatch = true;
  let objectsVerified = 0;

  // Write files first so we can read back
  const outputPackPath = `${packPath}.verified.pack`;
  const outputIdxPath = `${outputPackPath.slice(0, -5)}.idx`;
  await files.write(outputPackPath, [result.packData]);
  await files.write(outputIdxPath, [newIdxData]);

  // Open new pack for verification
  const newReader = new PackReader(files, outputPackPath, newIndex);
  await newReader.open();

  for (const origEntry of index.entries()) {
    const origObj = objects.find((o) => o.id === origEntry.id);
    if (!origObj) continue;

    const newObj = await newReader.get(origEntry.id);
    if (!newObj) {
      console.error(`  Missing object: ${origEntry.id}`);
      allObjectsMatch = false;
      continue;
    }

    // Compare content
    const contentMatch = compareBytes(origObj.content, newObj.content);
    if (!contentMatch.equal) {
      console.error(`  Content mismatch: ${formatId(origEntry.id)}`);
      console.error(`    Original: ${origObj.content.length} bytes`);
      console.error(`    New: ${newObj.content.length} bytes`);
      allObjectsMatch = false;
    }

    objectsVerified++;
  }

  await newReader.close();

  printInfo("Objects verified", objectsVerified);
  printInfo("All content matches", allObjectsMatch ? "YES" : "NO");

  // Output
  printSection("Output Files");
  console.log(`  Pack: ${outputPackPath}`);
  console.log(`  Index: ${outputIdxPath}`);

  // Final summary
  printSection("Summary");
  console.log(`
  Input:
    Pack: ${formatSize(packData.length)}
    Index: ${formatSize(idxData.length)}
    Objects: ${count}

  Output:
    Pack: ${formatSize(result.packData.length)}
    Index: ${formatSize(newIdxData.length)}
    Objects: ${newIndex.objectCount}

  Verification:
    Pack identical: ${packCmp.equal ? "YES" : "NO"}
    Index identical: ${idxCmp.equal ? "YES" : "NO"}
    Content matches: ${allObjectsMatch ? "YES" : "NO"}
  `);

  console.log("Done!");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
