/**
 * Delta instruction analyzer for random access
 *
 * Parses Git binary deltas into positioned instructions that can
 * be queried for range lookups.
 */

import type { AnalyzedDelta, PositionedInstruction } from "./random-access-delta.js";

/**
 * Analyze a Git binary delta into positioned instructions
 *
 * Parses the delta once and builds a position index mapping result
 * positions to their sources (base offset or insert data).
 *
 * @param delta Raw delta bytes
 * @returns Analyzed delta with positioned instructions
 */
export function analyzeDelta(delta: Uint8Array): AnalyzedDelta {
  let ptr = 0;

  // Read base object length (variable length int)
  let baseSize = 0;
  let shift = 0;
  let c: number;
  do {
    c = delta[ptr++];
    baseSize |= (c & 0x7f) << shift;
    shift += 7;
  } while ((c & 0x80) !== 0);

  // Read result object length (variable length int)
  let resultSize = 0;
  shift = 0;
  do {
    c = delta[ptr++];
    resultSize |= (c & 0x7f) << shift;
    shift += 7;
  } while ((c & 0x80) !== 0);

  // Parse instructions and track result positions
  const instructions: PositionedInstruction[] = [];
  let resultPos = 0;

  while (ptr < delta.length) {
    const cmd = delta[ptr++];

    if ((cmd & 0x80) !== 0) {
      // COPY command: copy from base
      let copyOffset = 0;
      if ((cmd & 0x01) !== 0) copyOffset = delta[ptr++];
      if ((cmd & 0x02) !== 0) copyOffset |= delta[ptr++] << 8;
      if ((cmd & 0x04) !== 0) copyOffset |= delta[ptr++] << 16;
      if ((cmd & 0x08) !== 0) copyOffset |= delta[ptr++] << 24;

      let copySize = 0;
      if ((cmd & 0x10) !== 0) copySize = delta[ptr++];
      if ((cmd & 0x20) !== 0) copySize |= delta[ptr++] << 8;
      if ((cmd & 0x40) !== 0) copySize |= delta[ptr++] << 16;
      if (copySize === 0) copySize = 0x10000;

      instructions.push({
        resultStart: resultPos,
        length: copySize,
        instruction: { type: "copy", baseOffset: copyOffset },
      });
      resultPos += copySize;
    } else if (cmd !== 0) {
      // INSERT command: literal data from delta
      const dataOffset = ptr;
      instructions.push({
        resultStart: resultPos,
        length: cmd,
        instruction: { type: "insert", dataOffset },
      });
      ptr += cmd;
      resultPos += cmd;
    } else {
      // Reserved command 0
      throw new Error("Unsupported delta command 0");
    }
  }

  return {
    baseSize,
    resultSize,
    instructions,
    rawDelta: delta,
  };
}

/**
 * Find instructions that overlap with a given range
 *
 * Uses binary search for O(log n) lookup to find the first instruction,
 * then collects all overlapping instructions.
 *
 * @param analyzed Analyzed delta
 * @param offset Start position in result
 * @param length Number of bytes
 * @returns Instructions that contribute to the range
 */
export function findInstructionsForRange(
  analyzed: AnalyzedDelta,
  offset: number,
  length: number,
): PositionedInstruction[] {
  if (length <= 0 || offset >= analyzed.resultSize) {
    return [];
  }

  const end = Math.min(offset + length, analyzed.resultSize);
  const result: PositionedInstruction[] = [];

  // Binary search for first potentially overlapping instruction
  let lo = 0;
  let hi = analyzed.instructions.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const instr = analyzed.instructions[mid];
    const instrEnd = instr.resultStart + instr.length;

    if (instrEnd <= offset) {
      // This instruction ends before our range starts
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  // Collect all overlapping instructions
  for (let i = lo; i < analyzed.instructions.length; i++) {
    const instr = analyzed.instructions[i];

    // Stop if this instruction starts after our range ends
    if (instr.resultStart >= end) {
      break;
    }

    result.push(instr);
  }

  return result;
}
