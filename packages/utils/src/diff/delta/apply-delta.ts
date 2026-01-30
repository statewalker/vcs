import { FossilChecksum } from "../../hash/fossil-checksum/index.js";
import { getGitDeltaBaseSize, getGitDeltaResultSize, parseGitDelta } from "./git-delta-format.js";
import type { Delta } from "./types.js";

// Re-export Git delta size utilities
export { getGitDeltaBaseSize, getGitDeltaResultSize };

/**
 * Apply a Git binary delta to a base object
 *
 * This function applies a Git pack delta format to reconstruct an object.
 * It validates that the base size matches the expected size encoded in the delta.
 *
 * Based on JGit's BinaryDelta.java
 * @see https://github.com/eclipse-jgit/jgit/blob/master/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/pack/BinaryDelta.java
 *
 * @param base The base object data
 * @param delta The Git binary delta to apply
 * @returns The resulting object data
 * @throws Error if base size doesn't match expected size in delta
 * @throws Error if result size doesn't match expected size in delta
 */
export function applyGitDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  const parsed = parseGitDelta(delta);

  // Validate base size
  if (base.length !== parsed.baseSize) {
    throw new Error(`Delta base length mismatch: expected ${parsed.baseSize}, got ${base.length}`);
  }

  // Allocate result buffer
  const result = new Uint8Array(parsed.resultSize);
  let resultPtr = 0;

  // Apply instructions
  for (const instr of parsed.instructions) {
    if (instr.type === "copy") {
      // COPY from base object
      result.set(base.subarray(instr.offset, instr.offset + instr.size), resultPtr);
      resultPtr += instr.size;
    } else {
      // INSERT literal data
      result.set(instr.data, resultPtr);
      resultPtr += instr.data.length;
    }
  }

  // Validate result size
  if (resultPtr !== parsed.resultSize) {
    throw new Error(`Delta result size mismatch: expected ${parsed.resultSize}, got ${resultPtr}`);
  }

  return result;
}

/**
 * Apply delta instructions to a source buffer (Fossil format)
 *
 * Generator that yields chunks of the resulting object.
 * Validates target length and checksum.
 *
 * @param source The source/base data
 * @param deltas Delta instructions (Fossil format with start/copy/insert/finish)
 * @yields Chunks of the resulting data
 * @throws Error if target length doesn't match expected
 * @throws Error if checksum doesn't match
 */
export function* applyDelta(source: Uint8Array, deltas: Iterable<Delta>): Generator<Uint8Array> {
  const checksumObj = new FossilChecksum();
  let expectedChecksum: number | undefined;
  let targetLen = 0;
  let expectedTargetLen = 0;
  for (const d of deltas) {
    switch (d.type) {
      case "start": {
        expectedTargetLen = d.targetLen;
        continue;
      }
      case "finish": {
        expectedChecksum = d.checksum;
        continue;
      }
      case "insert": {
        // Literal block
        const chunk = d.data;
        if (chunk.length > 0) {
          targetLen += chunk.length;
          checksumObj.update(chunk, 0, chunk.length);
          yield chunk;
        }
        continue;
      }
      case "copy": {
        // Copy from source
        if (d.len > 0) {
          const chunk = source.subarray(d.start, d.start + d.len);
          checksumObj.update(chunk, 0, chunk.length);
          targetLen += d.len;
          yield chunk;
        }
        continue;
      }
    }
  }

  if (targetLen !== expectedTargetLen) {
    throw new Error(`Target length mismatch: expected ${expectedTargetLen}, got ${targetLen}`);
  }

  // Validate checksum (required for integrity)
  if (expectedChecksum === undefined) {
    throw new Error("No checksum provided in delta");
  }

  const actualChecksum = checksumObj.finalize();
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`);
  }
}
