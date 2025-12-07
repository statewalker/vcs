/**
 * Example 3: Streaming Pack Writer with OFS_DELTA
 *
 * Demonstrates using PackWriterStream for incremental pack building
 * with offset-based delta encoding.
 */

import {
  readPackIndex,
  PackReader,
  PackWriterStream,
  writePackIndexV2,
  PackObjectType,
} from "@webrun-vcs/storage-git";
import {
  createFilesApi,
  getInputFile,
  printBanner,
  printSection,
  printInfo,
  formatId,
  formatSize,
  getTypeName,
  toHex,
} from "../shared/utils.js";

/**
 * Create a simple delta between two similar objects
 *
 * This is a basic implementation that creates a delta using:
 * - COPY commands for matching sections
 * - INSERT commands for new data
 *
 * Returns undefined if delta would be larger than original.
 */
function createDelta(base: Uint8Array, target: Uint8Array): Uint8Array | undefined {
  const chunks: Uint8Array[] = [];

  // Write base size (variable length)
  chunks.push(encodeVarint(base.length));

  // Write result size (variable length)
  chunks.push(encodeVarint(target.length));

  // Simple delta: if objects are similar enough, use COPY commands
  // For this example, we use a naive approach:
  // - Find matching prefix (COPY)
  // - INSERT the different middle
  // - Find matching suffix (COPY)

  let prefixLen = 0;
  const maxPrefix = Math.min(base.length, target.length);
  while (prefixLen < maxPrefix && base[prefixLen] === target[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  const maxSuffix = Math.min(base.length - prefixLen, target.length - prefixLen);
  while (
    suffixLen < maxSuffix &&
    base[base.length - 1 - suffixLen] === target[target.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const middleStart = prefixLen;
  const middleEnd = target.length - suffixLen;
  const insertLen = middleEnd - middleStart;

  // Only create delta if it's beneficial
  // If insert length is too large relative to target, skip
  if (insertLen > target.length * 0.8) {
    return undefined;
  }

  // COPY prefix from base
  if (prefixLen > 0) {
    chunks.push(createCopyCommand(0, prefixLen));
  }

  // INSERT middle
  if (insertLen > 0) {
    chunks.push(createInsertCommand(target.subarray(middleStart, middleEnd)));
  }

  // COPY suffix from base
  if (suffixLen > 0) {
    chunks.push(createCopyCommand(base.length - suffixLen, suffixLen));
  }

  // Calculate total delta size
  const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);

  // Only use delta if it's smaller than the target
  if (totalSize >= target.length) {
    return undefined;
  }

  // Concatenate all chunks
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Encode a variable-length integer
 */
function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  let v = value;

  bytes.push(v & 0x7f);
  v >>>= 7;

  while (v > 0) {
    bytes[bytes.length - 1] |= 0x80;
    bytes.push(v & 0x7f);
    v >>>= 7;
  }

  return new Uint8Array(bytes);
}

/**
 * Create a COPY command (copy from base object)
 */
function createCopyCommand(offset: number, size: number): Uint8Array {
  const bytes: number[] = [];
  let cmd = 0x80; // High bit indicates COPY

  // Encode offset bytes (up to 4)
  const offsetBytes: number[] = [];
  if ((offset & 0xff) !== 0) {
    cmd |= 0x01;
    offsetBytes.push(offset & 0xff);
  }
  if ((offset & 0xff00) !== 0) {
    cmd |= 0x02;
    offsetBytes.push((offset >> 8) & 0xff);
  }
  if ((offset & 0xff0000) !== 0) {
    cmd |= 0x04;
    offsetBytes.push((offset >> 16) & 0xff);
  }
  if ((offset & 0xff000000) !== 0) {
    cmd |= 0x08;
    offsetBytes.push((offset >> 24) & 0xff);
  }

  // Encode size bytes (up to 3, 0 means 0x10000)
  const sizeBytes: number[] = [];
  const actualSize = size === 0x10000 ? 0 : size;
  if ((actualSize & 0xff) !== 0) {
    cmd |= 0x10;
    sizeBytes.push(actualSize & 0xff);
  }
  if ((actualSize & 0xff00) !== 0) {
    cmd |= 0x20;
    sizeBytes.push((actualSize >> 8) & 0xff);
  }
  if ((actualSize & 0xff0000) !== 0) {
    cmd |= 0x40;
    sizeBytes.push((actualSize >> 16) & 0xff);
  }

  bytes.push(cmd);
  bytes.push(...offsetBytes);
  bytes.push(...sizeBytes);

  return new Uint8Array(bytes);
}

/**
 * Create an INSERT command (insert literal bytes)
 */
function createInsertCommand(data: Uint8Array): Uint8Array {
  // INSERT commands can only be up to 127 bytes at a time
  if (data.length === 0) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];

  for (let i = 0; i < data.length; i += 127) {
    const chunkLen = Math.min(127, data.length - i);
    const chunk = new Uint8Array(1 + chunkLen);
    chunk[0] = chunkLen; // Low bit clear, value is length
    chunk.set(data.subarray(i, i + chunkLen), 1);
    chunks.push(chunk);
  }

  // Concatenate chunks
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Group objects by type for delta analysis
 */
interface ObjectInfo {
  id: string;
  type: PackObjectType;
  content: Uint8Array;
  size: number;
}

async function main() {
  // Parse command line arguments
  const inputPath = getInputFile();
  const packPath = inputPath.endsWith(".idx")
    ? inputPath.slice(0, -4) + ".pack"
    : inputPath;
  const idxPath = packPath.slice(0, -5) + ".idx";

  printBanner("Git Pack Writer: Streaming with OFS_DELTA");
  printInfo("Input pack", packPath);
  printInfo("Input index", idxPath);

  // Create files API
  const files = createFilesApi();

  // Read the index file
  printSection("Reading Source Pack");
  const idxData = await files.readFile(idxPath);
  const index = readPackIndex(idxData);

  printInfo("Object count", index.objectCount);

  // Open pack reader
  const reader = new PackReader(files, packPath, index);
  await reader.open();

  // Read all objects
  const objects: ObjectInfo[] = [];
  for (const entry of index.entries()) {
    const obj = await reader.get(entry.id);
    if (obj) {
      objects.push({
        id: entry.id,
        type: obj.type,
        content: obj.content,
        size: obj.size,
      });
    }
  }
  await reader.close();

  // Group by type for delta analysis
  const byType = new Map<PackObjectType, ObjectInfo[]>();
  for (const obj of objects) {
    const group = byType.get(obj.type) ?? [];
    group.push(obj);
    byType.set(obj.type, group);
  }

  printSection("Objects by Type");
  for (const [type, group] of byType) {
    console.log(`  ${getTypeName(type)}: ${group.length} objects`);
  }

  // Create streaming pack writer
  printSection("Creating Pack with PackWriterStream");
  const writer = new PackWriterStream();

  // Statistics
  let wholeObjects = 0;
  let deltaObjects = 0;
  let deltaSavings = 0;

  // Process each type group
  // Write blobs first (most likely to have deltas)
  const typeOrder = [
    PackObjectType.BLOB,
    PackObjectType.TREE,
    PackObjectType.COMMIT,
    PackObjectType.TAG,
  ];

  for (const type of typeOrder) {
    const group = byType.get(type);
    if (!group || group.length === 0) continue;

    console.log(`\n  Processing ${getTypeName(type)} objects...`);

    // Sort by size to put smaller objects first (potential bases)
    group.sort((a, b) => a.size - b.size);

    // Track written objects for delta base selection
    const written = new Map<string, ObjectInfo>();

    for (const obj of group) {
      let usedDelta = false;

      // Try to find a good base for delta
      // Only try if we have some similar-sized objects already written
      if (written.size > 0) {
        let bestBase: ObjectInfo | null = null;
        let bestDelta: Uint8Array | null = null;

        // Look for potential base objects (similar size)
        for (const [_baseId, base] of written) {
          // Skip if sizes are too different
          if (Math.abs(base.size - obj.size) > Math.max(base.size, obj.size) * 0.5) {
            continue;
          }

          const delta = createDelta(base.content, obj.content);
          if (delta && (!bestDelta || delta.length < bestDelta.length)) {
            bestBase = base;
            bestDelta = delta;
          }
        }

        // Use delta if it saves space
        if (bestBase && bestDelta && bestDelta.length < obj.content.length * 0.9) {
          await writer.addOfsDelta(obj.id, bestBase.id, bestDelta);
          deltaObjects++;
          deltaSavings += obj.content.length - bestDelta.length;
          usedDelta = true;
        }
      }

      if (!usedDelta) {
        await writer.addObject(obj.id, obj.type, obj.content);
        wholeObjects++;
      }

      written.set(obj.id, obj);
    }
  }

  // Finalize pack
  printSection("Finalizing Pack");
  const result = await writer.finalize();

  printInfo("Whole objects", wholeObjects);
  printInfo("Delta objects", deltaObjects);
  printInfo("Delta savings", formatSize(deltaSavings));
  printInfo("Pack size", formatSize(result.packData.length));
  printInfo("Pack checksum", formatId(toHex(result.packChecksum), 12));

  // Write index
  const newIdxData = await writePackIndexV2(result.indexEntries, result.packChecksum);

  // Compare with original
  printSection("Size Comparison");
  const origPackData = await files.readFile(packPath);

  printInfo("Original pack", formatSize(origPackData.length));
  printInfo("New pack", formatSize(result.packData.length));

  const sizeDiff = result.packData.length - origPackData.length;
  const pctChange = ((sizeDiff / origPackData.length) * 100).toFixed(1);
  printInfo("Size change", `${sizeDiff > 0 ? "+" : ""}${sizeDiff} bytes (${pctChange}%)`);

  // Verify
  printSection("Verification");
  const newIndex = readPackIndex(newIdxData);
  const newReader = new PackReader(files, "", newIndex);

  // Can't actually verify without writing the file first
  // So we verify the index
  let allPresent = true;
  for (const entry of index.entries()) {
    if (!newIndex.has(entry.id)) {
      console.error(`  Missing: ${entry.id}`);
      allPresent = false;
    }
  }
  printInfo("All objects in index", allPresent ? "YES" : "NO");
  printInfo("Index entry count", newIndex.objectCount);

  // Write output
  printSection("Output");
  const outputPackPath = packPath + ".streamed.pack";
  const outputIdxPath = outputPackPath.slice(0, -5) + ".idx";

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
