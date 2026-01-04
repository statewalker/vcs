/**
 * Debug script to analyze a pack file
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { inflate } from "node:zlib";

const inflateAsync = promisify(inflate);

const PACK_PATH = path.join(
  process.cwd(),
  "apps/example-git-lifecycle/test-lifecycle-repo/.git/objects/pack/pack-mjrq9bhojx1cm3.pack",
);

type ObjectType = "commit" | "tree" | "blob" | "tag" | "ofs_delta" | "ref_delta";

function typeFromCode(code: number): ObjectType {
  switch (code) {
    case 1:
      return "commit";
    case 2:
      return "tree";
    case 3:
      return "blob";
    case 4:
      return "tag";
    case 6:
      return "ofs_delta";
    case 7:
      return "ref_delta";
    default:
      throw new Error(`Unknown type code: ${code}`);
  }
}

function readPackHeader(
  data: Uint8Array,
  offset: number,
): { type: number; size: number; bytesRead: number } {
  const b = data[offset];
  const type = (b >> 4) & 0x07;
  let size = b & 0x0f;
  let shift = 4;
  let bytesRead = 1;

  while ((data[offset + bytesRead - 1] & 0x80) !== 0) {
    const c = data[offset + bytesRead];
    size |= (c & 0x7f) << shift;
    shift += 7;
    bytesRead++;
  }

  return { type, size, bytesRead };
}

function readOfsVarint(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = data[offset] & 0x7f;
  let bytesRead = 1;

  while ((data[offset + bytesRead - 1] & 0x80) !== 0) {
    value += 1;
    value <<= 7;
    value |= data[offset + bytesRead] & 0x7f;
    bytesRead++;
  }

  return { value, bytesRead };
}

function readDeltaHeader(data: Uint8Array): {
  baseSize: number;
  resultSize: number;
  bytesRead: number;
} {
  let pos = 0;
  let baseSize = 0;
  let shift = 0;
  let c: number;

  do {
    c = data[pos++];
    baseSize |= (c & 0x7f) << shift;
    shift += 7;
  } while ((c & 0x80) !== 0);

  let resultSize = 0;
  shift = 0;

  do {
    c = data[pos++];
    resultSize |= (c & 0x7f) << shift;
    shift += 7;
  } while ((c & 0x80) !== 0);

  return { baseSize, resultSize, bytesRead: pos };
}

async function decompressObject(
  data: Uint8Array,
  offset: number,
  maxLen?: number,
): Promise<{ content: Uint8Array; compressedLen: number }> {
  // Try increasing amounts of data until decompression succeeds
  for (
    let len = 16;
    len <= (maxLen || data.length - offset);
    len = Math.min(len * 2, maxLen || data.length - offset)
  ) {
    try {
      const chunk = data.slice(offset, offset + len);
      const content = await inflateAsync(chunk);
      // Find actual compressed length by trying smaller chunks
      for (let testLen = 8; testLen <= len; testLen++) {
        try {
          const testChunk = data.slice(offset, offset + testLen);
          const testContent = await inflateAsync(testChunk);
          if (
            testContent.length === content.length &&
            Buffer.compare(Buffer.from(testContent), Buffer.from(content)) === 0
          ) {
            return { content: new Uint8Array(content), compressedLen: testLen };
          }
        } catch {
          // Keep trying
        }
      }
      return { content: new Uint8Array(content), compressedLen: len };
    } catch {
      if (len === maxLen || len >= data.length - offset) {
        throw new Error(`Failed to decompress at offset ${offset}`);
      }
    }
  }
  throw new Error(`Failed to decompress at offset ${offset}`);
}

async function main() {
  const packData = new Uint8Array(await fs.readFile(PACK_PATH));

  // Verify header
  const sig = String.fromCharCode(...packData.slice(0, 4));
  const version = (packData[4] << 24) | (packData[5] << 16) | (packData[6] << 8) | packData[7];
  const objectCount =
    (packData[8] << 24) | (packData[9] << 16) | (packData[10] << 8) | packData[11];

  console.log(`Pack file: ${PACK_PATH}`);
  console.log(`Signature: ${sig}`);
  console.log(`Version: ${version}`);
  console.log(`Object count: ${objectCount}`);
  console.log(`Total size: ${packData.length} bytes`);
  console.log();

  let offset = 12; // After header
  const objects: Array<{
    offset: number;
    type: ObjectType;
    size: number;
    baseOffset?: number;
    baseSize?: number;
    resultSize?: number;
  }> = [];

  for (let i = 0; i < objectCount && offset < packData.length - 20; i++) {
    const startOffset = offset;

    try {
      const header = readPackHeader(packData, offset);
      offset += header.bytesRead;

      const objInfo: (typeof objects)[0] = {
        offset: startOffset,
        type: typeFromCode(header.type),
        size: header.size,
      };

      if (header.type === 6) {
        // OFS_DELTA
        const ofsResult = readOfsVarint(packData, offset);
        offset += ofsResult.bytesRead;
        objInfo.baseOffset = startOffset - ofsResult.value;

        // Try to decompress and read delta header
        try {
          const { content, compressedLen } = await decompressObject(packData, offset, 2048);
          const deltaHeader = readDeltaHeader(content);
          objInfo.baseSize = deltaHeader.baseSize;
          objInfo.resultSize = deltaHeader.resultSize;
          offset += compressedLen;
        } catch (_e) {
          console.log(`  [Failed to decompress delta at offset ${offset}]`);
          offset += 10; // Skip some bytes and try to continue
        }
      } else if (header.type === 7) {
        // REF_DELTA
        // Skip 20-byte SHA-1
        offset += 20;
        try {
          const { content, compressedLen } = await decompressObject(packData, offset, 2048);
          const deltaHeader = readDeltaHeader(content);
          objInfo.baseSize = deltaHeader.baseSize;
          objInfo.resultSize = deltaHeader.resultSize;
          offset += compressedLen;
        } catch {
          offset += 10;
        }
      } else {
        // Regular object
        try {
          const { compressedLen } = await decompressObject(packData, offset, 4096);
          offset += compressedLen;
        } catch {
          offset += 10;
        }
      }

      objects.push(objInfo);
    } catch (e) {
      console.log(`Error at offset ${startOffset}: ${e}`);
      break;
    }
  }

  console.log(`\nParsed ${objects.length} objects:\n`);

  // Print objects around the error offset (5897)
  console.log("Objects around offset 5897:");
  for (const obj of objects) {
    if (obj.offset >= 5500 && obj.offset <= 6500) {
      let line = `  ${obj.offset}: ${obj.type} size=${obj.size}`;
      if (obj.baseOffset !== undefined) {
        line += ` baseOffset=${obj.baseOffset}`;
      }
      if (obj.baseSize !== undefined) {
        line += ` deltaBaseSize=${obj.baseSize} resultSize=${obj.resultSize}`;
      }
      console.log(line);

      // If this is a delta, find and print the base object
      if (obj.baseOffset !== undefined) {
        const base = objects.find((o) => o.offset === obj.baseOffset);
        if (base) {
          console.log(`    -> base at ${base.offset}: ${base.type} size=${base.size}`);
        } else {
          console.log(`    -> BASE NOT FOUND at offset ${obj.baseOffset}`);
        }
      }
    }
  }

  console.log("\nFull object listing:");
  for (const obj of objects) {
    let line = `  ${obj.offset}: ${obj.type} size=${obj.size}`;
    if (obj.baseOffset !== undefined) {
      line += ` baseOffset=${obj.baseOffset}`;
    }
    if (obj.baseSize !== undefined) {
      line += ` deltaBaseSize=${obj.baseSize}`;
    }
    console.log(line);
  }
}

main().catch(console.error);
