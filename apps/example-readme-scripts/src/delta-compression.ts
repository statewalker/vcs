/**
 * Delta Compression
 *
 * This example demonstrates delta compression for efficient storage:
 * - Compute delta ranges between two byte arrays
 * - Create delta instructions from the ranges
 * - Apply delta to reconstruct the target content
 *
 * Delta compression stores only the differences between similar files,
 * significantly reducing storage requirements for version control.
 *
 * Run with: pnpm --filter @statewalker/vcs-example-readme-scripts delta-compression
 */

import { applyDelta, createDelta, createDeltaRanges } from "@statewalker/vcs-utils/diff";

// Original content
const baseContent = new TextEncoder().encode("Original file content");
// Modified content with additions
const newContent = new TextEncoder().encode("Original file content with additions");

console.log("Base content:", new TextDecoder().decode(baseContent));
console.log("New content:", new TextDecoder().decode(newContent));
console.log("Base size:", baseContent.length, "bytes");
console.log("New size:", newContent.length, "bytes");

// Step 1: Compute delta ranges between base and new content
// This identifies which parts can be copied from the base and which are new
const ranges = [...createDeltaRanges(baseContent, newContent)];

console.log("\nDelta ranges computed:", ranges.length, "ranges");
for (const range of ranges) {
  if (range.from === "source") {
    console.log(`  COPY: ${range.len} bytes from base at offset ${range.start}`);
  } else {
    console.log(`  INSERT: ${range.len} bytes of new content at offset ${range.start}`);
  }
}

// Step 2: Create delta instructions from the ranges
// This produces a sequence of copy/insert operations with checksums
const delta = [...createDelta(baseContent, newContent, ranges)];

console.log("\nDelta instructions:", delta.length, "instructions");
let deltaSize = 0;
for (const instruction of delta) {
  switch (instruction.type) {
    case "start":
      console.log(`  START: source=${instruction.sourceLen}, target=${instruction.targetLen}`);
      break;
    case "copy":
      console.log(`  COPY: ${instruction.len} bytes from offset ${instruction.start}`);
      deltaSize += 8; // Approximate overhead for copy instruction
      break;
    case "insert":
      console.log(`  INSERT: ${instruction.data.length} bytes`);
      deltaSize += instruction.data.length;
      break;
    case "finish":
      console.log(`  FINISH: checksum=${instruction.checksum}`);
      break;
  }
}

// Step 3: Apply delta to reconstruct the target content
// This takes the base content and delta instructions to produce the target
const reconstructedChunks = [...applyDelta(baseContent, delta)];
const reconstructed = new Uint8Array(
  reconstructedChunks.reduce((sum, chunk) => sum + chunk.length, 0),
);
let offset = 0;
for (const chunk of reconstructedChunks) {
  reconstructed.set(chunk, offset);
  offset += chunk.length;
}

console.log("\nReconstruction:");
console.log("Reconstructed content:", new TextDecoder().decode(reconstructed));
console.log("Reconstructed size:", reconstructed.length, "bytes");

// Verify the reconstruction matches the original
const matches =
  reconstructed.length === newContent.length &&
  reconstructed.every((byte, i) => byte === newContent[i]);

console.log("\nVerification:");
console.log("  Reconstructed matches original:", matches ? "YES" : "NO");
console.log("  Storage savings: ~", Math.round((1 - deltaSize / newContent.length) * 100), "%");
console.log("  (Base content already stored, only delta needed for new version)");

console.log("\nDelta Compression example completed successfully!");
