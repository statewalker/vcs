/**
 * Debug script to trace object loading flow during delta computation
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { inflate } from "node:zlib";

const inflateAsync = promisify(inflate);

const TEST_REPO = path.join(process.cwd(), "apps/example-git-lifecycle/test-lifecycle-repo/.git");

/**
 * Find null byte in buffer
 */
function findNullByte(buf: Uint8Array, maxLen = 32): number {
  const limit = Math.min(maxLen, buf.length);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return i;
  }
  return -1;
}

/**
 * Parse Git object header
 */
function parseGitHeader(buf: Uint8Array): { type: string; size: number; headerLen: number } | null {
  const nullPos = findNullByte(buf);
  if (nullPos === -1) return null;

  const headerStr = new TextDecoder().decode(buf.subarray(0, nullPos));
  const spacePos = headerStr.indexOf(" ");
  if (spacePos === -1) return null;

  return {
    type: headerStr.substring(0, spacePos),
    size: parseInt(headerStr.substring(spacePos + 1), 10),
    headerLen: nullPos + 1,
  };
}

/**
 * Load loose object
 */
async function _loadLooseObject(oid: string): Promise<{
  raw: Uint8Array;
  header: ReturnType<typeof parseGitHeader>;
  content: Uint8Array;
} | null> {
  const objectPath = path.join(TEST_REPO, "objects", oid.substring(0, 2), oid.substring(2));
  try {
    const compressed = await fs.readFile(objectPath);
    const raw = new Uint8Array(await inflateAsync(compressed));
    const header = parseGitHeader(raw);
    if (!header) return null;
    return {
      raw,
      header,
      content: raw.subarray(header.headerLen),
    };
  } catch {
    return null;
  }
}

/**
 * Read pack index to find object offset
 */
async function findOffsetInPack(oid: string, idxPath: string): Promise<number> {
  const idxData = new Uint8Array(await fs.readFile(idxPath));

  // Check for v2 index magic
  const magic = (idxData[0] << 24) | (idxData[1] << 16) | (idxData[2] << 8) | idxData[3];
  if (magic !== 0xff744f63) {
    console.log("Not a v2 index");
    return -1;
  }

  const version = (idxData[4] << 24) | (idxData[5] << 16) | (idxData[6] << 8) | idxData[7];
  if (version !== 2) {
    console.log(`Unsupported index version: ${version}`);
    return -1;
  }

  // Fanout table at offset 8, 256 entries x 4 bytes
  const fanoutStart = 8;
  const totalObjects =
    (idxData[fanoutStart + 255 * 4] << 24) |
    (idxData[fanoutStart + 255 * 4 + 1] << 16) |
    (idxData[fanoutStart + 255 * 4 + 2] << 8) |
    idxData[fanoutStart + 255 * 4 + 3];

  // SHA-1 table starts after fanout
  const sha1Start = fanoutStart + 256 * 4;

  // Binary search in SHA-1 table
  const oidBytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    oidBytes[i] = parseInt(oid.substring(i * 2, i * 2 + 2), 16);
  }

  let lo = 0;
  let hi = totalObjects;
  const firstByte = oidBytes[0];
  if (firstByte > 0) {
    lo =
      (idxData[fanoutStart + (firstByte - 1) * 4] << 24) |
      (idxData[fanoutStart + (firstByte - 1) * 4 + 1] << 16) |
      (idxData[fanoutStart + (firstByte - 1) * 4 + 2] << 8) |
      idxData[fanoutStart + (firstByte - 1) * 4 + 3];
  }
  hi =
    (idxData[fanoutStart + firstByte * 4] << 24) |
    (idxData[fanoutStart + firstByte * 4 + 1] << 16) |
    (idxData[fanoutStart + firstByte * 4 + 2] << 8) |
    idxData[fanoutStart + firstByte * 4 + 3];

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const entryOffset = sha1Start + mid * 20;
    let cmp = 0;
    for (let i = 0; i < 20 && cmp === 0; i++) {
      cmp = oidBytes[i] - idxData[entryOffset + i];
    }
    if (cmp === 0) {
      // Found! Read offset from offset table
      // CRC table follows SHA-1 table
      const crcStart = sha1Start + totalObjects * 20;
      // 4-byte offset table follows CRC table
      const offsetStart = crcStart + totalObjects * 4;
      const offsetEntry = offsetStart + mid * 4;
      const offset =
        (idxData[offsetEntry] << 24) |
        (idxData[offsetEntry + 1] << 16) |
        (idxData[offsetEntry + 2] << 8) |
        idxData[offsetEntry + 3];
      return offset;
    } else if (cmp < 0) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return -1;
}

/**
 * Read pack entry header
 */
function readPackEntryHeader(
  packData: Uint8Array,
  offset: number,
): { type: number; size: number; headerLen: number } {
  const b = packData[offset];
  const type = (b >> 4) & 0x07;
  let size = b & 0x0f;
  let shift = 4;
  let headerLen = 1;

  while ((packData[offset + headerLen - 1] & 0x80) !== 0) {
    const c = packData[offset + headerLen];
    size |= (c & 0x7f) << shift;
    shift += 7;
    headerLen++;
  }

  return { type, size, headerLen };
}

/**
 * Load object from pack file
 */
async function _loadPackObject(
  oid: string,
): Promise<{ type: number; size: number; content: Uint8Array } | null> {
  const packDir = path.join(TEST_REPO, "objects", "pack");
  const files = await fs.readdir(packDir);
  const packFiles = files.filter((f) => f.endsWith(".pack"));

  for (const packFile of packFiles) {
    const idxFile = packFile.replace(".pack", ".idx");
    const idxPath = path.join(packDir, idxFile);
    const packPath = path.join(packDir, packFile);

    const offset = await findOffsetInPack(oid, idxPath);
    if (offset === -1) continue;

    const packData = new Uint8Array(await fs.readFile(packPath));
    const header = readPackEntryHeader(packData, offset);

    // For non-delta types (1-4), decompress directly
    if (header.type >= 1 && header.type <= 4) {
      // Decompress content
      const compressedStart = offset + header.headerLen;
      const maxCompressed = Math.min(packData.length - compressedStart, header.size * 3 + 1024);
      const compressed = packData.slice(compressedStart, compressedStart + maxCompressed);

      try {
        const content = new Uint8Array(await inflateAsync(compressed));
        return { type: header.type, size: header.size, content };
      } catch (e) {
        console.log(`Failed to decompress: ${e}`);
        return null;
      }
    }

    console.log(`Object ${oid} is delta type ${header.type}`);
    return null;
  }

  return null;
}

async function main() {
  console.log("Debug: Object loading flow analysis\n");

  // Find a pack file
  const packDir = path.join(TEST_REPO, "objects", "pack");
  let packFiles: string[];
  try {
    packFiles = (await fs.readdir(packDir)).filter((f) => f.endsWith(".pack"));
  } catch {
    console.log("No pack directory found");
    return;
  }

  if (packFiles.length === 0) {
    console.log("No pack files found");
    return;
  }

  console.log(`Found ${packFiles.length} pack file(s): ${packFiles.join(", ")}\n`);

  // Load pack and find a non-delta blob
  const packPath = path.join(packDir, packFiles[0]);
  const packData = new Uint8Array(await fs.readFile(packPath));

  // Skip header
  const objectCount =
    (packData[8] << 24) | (packData[9] << 16) | (packData[10] << 8) | packData[11];
  console.log(`Pack has ${objectCount} objects\n`);

  // Find blob at offset 316 (from analysis)
  const testOffset = 316;
  const header = readPackEntryHeader(packData, testOffset);
  console.log(`Object at offset ${testOffset}:`);
  console.log(
    `  Type code: ${header.type} (${["", "commit", "tree", "blob", "tag"][header.type] || "unknown"})`,
  );
  console.log(`  Size: ${header.size}`);
  console.log(`  Header length: ${header.headerLen}`);

  // Decompress
  const compressedStart = testOffset + header.headerLen;
  const maxCompressed = Math.min(packData.length - compressedStart, header.size * 3 + 1024);
  const compressed = packData.slice(compressedStart, compressedStart + maxCompressed);

  try {
    const content = new Uint8Array(await inflateAsync(compressed));
    console.log(`  Decompressed size: ${content.length}`);
    console.log(`  First 50 bytes: ${new TextDecoder().decode(content.subarray(0, 50))}`);

    // Now simulate what loadRaw does
    const typeNames = ["", "commit", "tree", "blob", "tag"];
    const typeName = typeNames[header.type];
    const gitHeader = `${typeName} ${content.length}\0`;
    const gitHeaderBytes = new TextEncoder().encode(gitHeader);

    console.log(`\nSimulated loadRaw output:`);
    console.log(
      `  Git header: "${typeName} ${content.length}\\0" (${gitHeaderBytes.length} bytes)`,
    );
    console.log(`  Total with header: ${gitHeaderBytes.length + content.length} bytes`);

    // Simulate stripGitHeader
    const withHeader = new Uint8Array(gitHeaderBytes.length + content.length);
    withHeader.set(gitHeaderBytes, 0);
    withHeader.set(content, gitHeaderBytes.length);

    const nullPos = findNullByte(withHeader);
    console.log(`  Null byte position: ${nullPos}`);

    const stripped = withHeader.subarray(nullPos + 1);
    console.log(`  After stripping header: ${stripped.length} bytes`);

    // Compare
    console.log(`\nComparison:`);
    console.log(`  Stored content size: ${header.size}`);
    console.log(`  Decompressed size: ${content.length}`);
    console.log(`  After strip: ${stripped.length}`);
    console.log(`  Match: ${content.length === stripped.length ? "YES" : "NO"}`);
  } catch (e) {
    console.log(`  Failed to decompress: ${e}`);
  }

  // Now let's look at a delta and its base
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Analyzing delta at offset 5746`);

  const deltaOffset = 5746;
  const deltaHeader = readPackEntryHeader(packData, deltaOffset);
  console.log(`  Type code: ${deltaHeader.type}`);
  console.log(`  Size: ${deltaHeader.size}`);

  if (deltaHeader.type === 6) {
    // OFS_DELTA - read offset
    let ofs = 0;
    let pos = deltaOffset + deltaHeader.headerLen;
    let c = packData[pos++];
    ofs = c & 0x7f;
    while ((c & 0x80) !== 0) {
      ofs += 1;
      ofs <<= 7;
      c = packData[pos++];
      ofs |= c & 0x7f;
    }
    const baseOffset = deltaOffset - ofs;
    console.log(`  Base offset: ${baseOffset} (current - ${ofs})`);

    // Decompress delta
    const deltaCompressedStart = pos;
    const deltaMaxCompressed = Math.min(packData.length - deltaCompressedStart, 4096);
    const deltaCompressed = packData.slice(
      deltaCompressedStart,
      deltaCompressedStart + deltaMaxCompressed,
    );

    try {
      const deltaContent = new Uint8Array(await inflateAsync(deltaCompressed));
      console.log(`  Delta content size: ${deltaContent.length}`);

      // Read base size from delta header
      let p = 0;
      let baseSize = 0;
      let shift = 0;
      let ch: number;
      do {
        ch = deltaContent[p++];
        baseSize |= (ch & 0x7f) << shift;
        shift += 7;
      } while ((ch & 0x80) !== 0);

      let resultSize = 0;
      shift = 0;
      do {
        ch = deltaContent[p++];
        resultSize |= (ch & 0x7f) << shift;
        shift += 7;
      } while ((ch & 0x80) !== 0);

      console.log(`  Delta header: baseSize=${baseSize}, resultSize=${resultSize}`);

      // Load base
      const baseHeader = readPackEntryHeader(packData, baseOffset);
      console.log(`  Base object: type=${baseHeader.type}, size=${baseHeader.size}`);

      console.log(
        `\n  MISMATCH: Delta expects baseSize=${baseSize}, but base has size=${baseHeader.size}`,
      );
      console.log(`  Difference: ${baseHeader.size - baseSize} bytes`);
    } catch (e) {
      console.log(`  Failed to decompress delta: ${e}`);
    }
  }
}

main().catch(console.error);
