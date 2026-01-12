/**
 * Step 05: Delta Compression Internals
 *
 * This step demonstrates how delta compression works to efficiently
 * store similar content by only keeping the differences.
 *
 * Key concepts:
 * - Delta = instructions to transform base into target
 * - Copy instructions: copy bytes from base
 * - Insert instructions: add new bytes
 * - Rolling hash for finding matching blocks
 */

import { applyDelta, createDelta, createDeltaRanges } from "@statewalker/vcs-utils/diff";
import { log, logInfo, logSection, logSuccess } from "../shared/index.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Concatenate byte arrays.
 */
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

export async function run(): Promise<void> {
  logSection("Step 05: Delta Compression Internals");

  log("Delta compression stores only the differences between similar content.\n");

  // Simple example
  log("--- Basic Delta Example ---\n");

  const base = textEncoder.encode("Hello World! This is the original content.");
  const target = textEncoder.encode("Hello World! This is the modified content.");

  log("Base content:");
  log(`  "${textDecoder.decode(base)}"`);
  logInfo("  Size", `${base.length} bytes`);

  log("\nTarget content:");
  log(`  "${textDecoder.decode(target)}"`);
  logInfo("  Size", `${target.length} bytes`);

  // Create delta ranges
  const ranges = [...createDeltaRanges(base, target)];

  log("\n--- Delta Ranges ---\n");
  log("Delta ranges identify what to copy vs insert:\n");

  let copyBytes = 0;
  let insertBytes = 0;

  for (const range of ranges) {
    if (range.from === "source") {
      log(`  COPY ${range.len} bytes from base at offset ${range.start}`);
      copyBytes += range.len;
    } else {
      const insertedText = textDecoder.decode(
        target.subarray(range.start, range.start + range.len),
      );
      log(`  INSERT ${range.len} bytes: "${insertedText}"`);
      insertBytes += range.len;
    }
  }

  log(`\nTotal: ${ranges.length} ranges`);
  logInfo("  Copy bytes", copyBytes);
  logInfo("  Insert bytes", insertBytes);

  // Create delta instructions
  const delta = [...createDelta(base, target, ranges)];

  log("\n--- Delta Instructions ---\n");

  for (const instruction of delta) {
    switch (instruction.type) {
      case "start":
        log(`  START: source=${instruction.sourceLen}, target=${instruction.targetLen}`);
        break;
      case "copy":
        log(`  COPY: ${instruction.len} bytes from offset ${instruction.start}`);
        break;
      case "insert":
        log(`  INSERT: ${instruction.data.length} bytes`);
        break;
      case "finish":
        log(`  FINISH: checksum=${instruction.checksum}`);
        break;
    }
  }

  // Apply delta to reconstruct
  log("\n--- Reconstructing from Delta ---\n");

  const chunks = [...applyDelta(base, delta)];
  const reconstructed = concatBytes(...chunks);
  const reconstructedText = textDecoder.decode(reconstructed);

  log(`Reconstructed: "${reconstructedText}"`);
  log(`Matches original: ${reconstructedText === textDecoder.decode(target)}`);

  // Larger example with more complex changes
  log("\n--- More Complex Example ---\n");

  const doc1 = textEncoder.encode(`# Document Title

This is the first paragraph of the document.
It contains some important information.

## Section One

Here is some content in section one.
It has multiple lines of text.

## Section Two

More content here in section two.
This section is also important.
`);

  const doc2 = textEncoder.encode(`# Document Title

This is the first paragraph of the document.
It contains some important information.

## Section One

Here is some MODIFIED content in section one.
It has multiple lines of text.
Added a new line here.

## Section Two

More content here in section two.
This section is also important.

## Section Three (NEW)

This is a completely new section.
`);

  log("Document 1:");
  logInfo("  Size", `${doc1.length} bytes`);

  log("\nDocument 2 (with changes):");
  logInfo("  Size", `${doc2.length} bytes`);

  const docRanges = [...createDeltaRanges(doc1, doc2)];
  const docDelta = [...createDelta(doc1, doc2, docRanges)];

  let deltaCopyBytes = 0;
  let deltaInsertBytes = 0;
  let deltaOverhead = 8; // Approximate header overhead

  for (const instruction of docDelta) {
    if (instruction.type === "copy") {
      deltaCopyBytes += instruction.len;
      deltaOverhead += 4; // Approximate copy instruction overhead
    } else if (instruction.type === "insert") {
      deltaInsertBytes += instruction.data.length;
      deltaOverhead += 1; // Insert instruction overhead
    }
  }

  const estimatedDeltaSize = deltaInsertBytes + deltaOverhead;

  log("\nDelta analysis:");
  logInfo("  Copy bytes", deltaCopyBytes);
  logInfo("  Insert bytes", deltaInsertBytes);
  logInfo("  Estimated delta size", `~${estimatedDeltaSize} bytes`);
  logInfo("  Savings", `~${Math.round((1 - estimatedDeltaSize / doc2.length) * 100)}%`);

  // Explain Git delta format
  log("\n--- Git Delta Format ---\n");

  log("Git uses a specific binary format for deltas:\n");

  log("Header:");
  log("  - Source size (variable length integer)");
  log("  - Target size (variable length integer)");

  log("\nInstructions:");
  log("  Copy instruction (high bit set):");
  log("    - Offset: 1-4 bytes (encoded in command byte)");
  log("    - Size: 1-3 bytes (encoded in command byte)");
  log("    - Copies bytes from base object");

  log("\n  Insert instruction (high bit clear):");
  log("    - Size: command byte value (1-127)");
  log("    - Data: literal bytes to insert");

  // When to use delta compression
  log("\n--- When Delta Compression Helps ---\n");

  log("Good candidates for delta compression:");
  log("  - Text files with small changes");
  log("  - Similar files (renamed/moved)");
  log("  - Sequential versions of documents");
  log("  - Configuration files");

  log("\nPoor candidates:");
  log("  - Completely different content");
  log("  - Heavily compressed files (images, videos)");
  log("  - Encrypted content");
  log("  - Small files (overhead may exceed savings)");

  // Summary
  log("\n--- Key Takeaways ---\n");
  log("1. Delta compression reduces storage for similar content");
  log("2. Works by identifying matching blocks via rolling hash");
  log("3. Creates copy + insert instructions to rebuild target");
  log("4. Git uses deltas extensively in pack files");
  log("5. Most effective for text files with incremental changes");

  logSuccess("\nDelta compression demonstration complete!");
}
