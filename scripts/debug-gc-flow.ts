/**
 * Debug script that simulates the exact GC flow and logs sizes at each step
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
 * Strip Git header from buffer (simulate stripGitHeader from raw-store-with-delta.ts)
 */
function stripGitHeader(buffer: Uint8Array): Uint8Array {
  const maxHeaderLen = Math.min(32, buffer.length);
  for (let i = 0; i < maxHeaderLen; i++) {
    if (buffer[i] === 0) {
      return buffer.subarray(i + 1);
    }
  }
  return buffer;
}

/**
 * Load a loose object and return both raw and stripped content
 */
async function loadLooseObject(oid: string): Promise<{
  rawSize: number;
  headerSize: number;
  contentSize: number;
  header: string;
  firstBytes: string;
} | null> {
  const objectPath = path.join(TEST_REPO, "objects", oid.substring(0, 2), oid.substring(2));
  try {
    const compressed = await fs.readFile(objectPath);
    const raw = new Uint8Array(await inflateAsync(compressed));

    const nullPos = findNullByte(raw);
    if (nullPos === -1) {
      return {
        rawSize: raw.length,
        headerSize: 0,
        contentSize: raw.length,
        header: "(no header)",
        firstBytes: new TextDecoder().decode(raw.subarray(0, 20)),
      };
    }

    const header = new TextDecoder().decode(raw.subarray(0, nullPos));
    const content = raw.subarray(nullPos + 1);

    return {
      rawSize: raw.length,
      headerSize: nullPos + 1,
      contentSize: content.length,
      header,
      firstBytes: new TextDecoder().decode(content.subarray(0, Math.min(20, content.length))),
    };
  } catch (_e) {
    return null;
  }
}

/**
 * Simulate what storeObject does: use readHeader to split stream
 */
async function simulateStoreObject(data: Uint8Array): Promise<{
  headerBytes: Uint8Array;
  contentBytes: Uint8Array;
}> {
  // This simulates: readHeader(asyncContent, newByteSplitter(0), 32)
  // Since I can't easily import the actual functions, I'll simulate the behavior

  // Find the null byte
  const nullPos = findNullByte(data);
  if (nullPos === -1) {
    return {
      headerBytes: new Uint8Array(0),
      contentBytes: data,
    };
  }

  // readHeader returns [header including null, rest]
  // But wait - looking at the code, readHeader collects header which includes the delimiter
  return {
    headerBytes: data.subarray(0, nullPos + 1),
    contentBytes: data.subarray(nullPos + 1),
  };
}

/**
 * Simulate what deltify does: use stripGitHeaderAndCollect
 */
function simulateDeltifyLoad(data: Uint8Array): Uint8Array {
  // This simulates: stripGitHeaderAndCollect(stream)
  return stripGitHeader(data);
}

async function main() {
  console.log("Debug: Simulating GC flow\n");

  // List all loose objects
  const objectsDir = path.join(TEST_REPO, "objects");
  const looseObjects: string[] = [];

  try {
    const prefixes = await fs.readdir(objectsDir);
    for (const prefix of prefixes) {
      if (prefix.length !== 2) continue;
      if (prefix === "pa") continue; // Skip pack directory

      const prefixPath = path.join(objectsDir, prefix);
      try {
        const files = await fs.readdir(prefixPath);
        for (const file of files) {
          looseObjects.push(prefix + file);
        }
      } catch {
        // Ignore errors
      }
    }
  } catch (_e) {
    console.log("No loose objects found");
    return;
  }

  console.log(`Found ${looseObjects.length} loose objects\n`);

  if (looseObjects.length === 0) {
    console.log("No loose objects to analyze. Run the example app without GC first.");
    return;
  }

  // Analyze each object
  const mismatches: Array<{
    oid: string;
    rawSize: number;
    storeContentSize: number;
    deltifyContentSize: number;
  }> = [];

  for (const oid of looseObjects.slice(0, 20)) {
    const objectPath = path.join(TEST_REPO, "objects", oid.substring(0, 2), oid.substring(2));
    let compressed: Buffer;
    try {
      compressed = await fs.readFile(objectPath);
    } catch {
      continue;
    }

    const raw = new Uint8Array(await inflateAsync(compressed));

    // Simulate storeObject
    const storeResult = await simulateStoreObject(raw);

    // Simulate deltify load
    const deltifyContent = simulateDeltifyLoad(raw);

    if (storeResult.contentBytes.length !== deltifyContent.length) {
      mismatches.push({
        oid,
        rawSize: raw.length,
        storeContentSize: storeResult.contentBytes.length,
        deltifyContentSize: deltifyContent.length,
      });
    }
  }

  if (mismatches.length > 0) {
    console.log("MISMATCHES FOUND:\n");
    for (const m of mismatches) {
      console.log(`  ${m.oid}:`);
      console.log(`    Raw size: ${m.rawSize}`);
      console.log(`    storeObject content size: ${m.storeContentSize}`);
      console.log(`    deltify content size: ${m.deltifyContentSize}`);
      console.log(`    Difference: ${m.storeContentSize - m.deltifyContentSize}`);
    }
  } else {
    console.log("No mismatches found in basic simulation.");
    console.log("\nLet me check if the issue is specific to certain object types...\n");
  }

  // Now let's look at specific objects that might have issues
  console.log("Checking objects for null bytes in content:\n");

  for (const oid of looseObjects) {
    const objectPath = path.join(TEST_REPO, "objects", oid.substring(0, 2), oid.substring(2));
    let compressed: Buffer;
    try {
      compressed = await fs.readFile(objectPath);
    } catch {
      continue;
    }

    const raw = new Uint8Array(await inflateAsync(compressed));
    const nullPos = findNullByte(raw);

    if (nullPos === -1) continue;

    const content = raw.subarray(nullPos + 1);

    // Check if content has null bytes
    let contentNulls = 0;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === 0) contentNulls++;
    }

    if (contentNulls > 0) {
      console.log(
        `  ${oid}: content has ${contentNulls} null byte(s), content size = ${content.length}`,
      );
    }
  }

  // Check a specific case - the blob with 348 bytes
  console.log("\nLooking for blob with ~348 bytes of content:\n");

  for (const oid of looseObjects) {
    const info = await loadLooseObject(oid);
    if (info && info.contentSize >= 340 && info.contentSize <= 360) {
      console.log(`  ${oid}:`);
      console.log(`    Header: "${info.header}"`);
      console.log(`    Content size: ${info.contentSize}`);
      console.log(`    First bytes: "${info.firstBytes}"`);
    }
  }
}

main().catch(console.error);
