// ============================================================================
// ---- Rolling checksum functions ----
// Rolling checksum (weak, Rabin–Karp style)
// This mirrors the classic rsync/Fossil pattern

export interface RollingChecksum {
  s1: number;
  s2: number;
  n: number; // window size
}

// Initialize rolling checksum for a window
export function rollingInit(buf: Uint8Array, offset: number, len: number): RollingChecksum {
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < len; i++) {
    s1 = (s1 + buf[offset + i]) | 0;
    s2 = (s2 + s1) | 0;
  }
  return { s1, s2, n: len };
}

// Slide the window by one byte: remove old byte, add new byte
export function rollingSlide(rc: RollingChecksum, removeByte: number, addByte: number): void {
  // All math in 32-bit signed, but we mask later
  rc.s1 = (rc.s1 - removeByte + addByte) | 0;
  rc.s2 = (rc.s2 - rc.n * removeByte + rc.s1) | 0;
}

// Get the 32-bit weak checksum value
export function rollingValue(rc: RollingChecksum): number {
  // Keep it close to Fossil’s pattern: lower 16 bits of s1, lower 16 of s2
  const s1 = rc.s1 & 0xffff;
  const s2 = rc.s2 & 0xffff;
  return (s1 | (s2 << 16)) >>> 0;
}

// Convenience: compute weak checksum for a window
export function weakChecksum(buf: Uint8Array, offset: number, len: number): number {
  const rc = rollingInit(buf, offset, len);
  return rollingValue(rc);
}

// ---- Strong checksum functions ----
// Strong checksum (FNV-1a 32-bit)
// In the future, we might want to swap this out for a better hash (e.g., xxHash)
export function strongChecksum(buf: Uint8Array, offset: number, len: number): number {
  let hash = 0x811c9dc5 | 0; // FNV-1a offset basis
  for (let i = 0; i < len; i++) {
    hash ^= buf[offset + i];
    hash = (hash * 0x01000193) >>> 0; // FNV prime
  }
  return hash >>> 0;
}

// // Combine weak and strong checksums into a single 64-bit value
// function combinedChecksum(weak: number, strong: number): bigint {
//   return (BigInt(weak) << 32n) | BigInt(strong);
// }

// ============================================================================
// ---- Build source index ----
// Index for blocks aligned to blockSize boundaries

export interface SourceBlock {
  pos: number; // position in source
  weak: number; // weak rolling checksum
  strong: number; // strong checksum
}

export interface SourceIndex {
  blockSize: number;
  source: Uint8Array;
  map: Map<number, SourceBlock[]>;
}

export const DEFAULT_BLOCK_SIZE = 16;

export function buildSourceIndex(source: Uint8Array, blockSize: number = DEFAULT_BLOCK_SIZE): SourceIndex {
  const map = new Map<number, SourceBlock[]>();

  for (let pos = 0; pos + blockSize <= source.length; pos += blockSize) {
    const weak = weakChecksum(source, pos, blockSize);
    const strong = strongChecksum(source, pos, blockSize);
    const block: SourceBlock = { pos, weak, strong };

    const list = map.get(weak);
    if (list) {
      list.push(block);
    } else {
      map.set(weak, [block]);
    }
  }

  return { blockSize, source, map };
}

// ============================================================================
// ---- Delta range definitions ----

import type { DeltaRange } from "../types.js";

interface RangeAccumulator {
  last?: DeltaRange;
}

/**
 * Merge-adjacent range emitter.
 * Keeps state in `acc.last` and yields only when necessary.
 */
export function* emitRange(acc: RangeAccumulator, next: DeltaRange | undefined): Generator<DeltaRange> {
  if (!next) {
    return;
  }

  const prev = acc.last;
  if (prev && prev.from === next.from && prev.start + prev.len === next.start) {
    // Extend previous range
    prev.len += next.len;
    return;
  }

  if (prev) {
    yield prev;
  }

  acc.last = { ...next };
}

// ============================================================================

export function* createFossilLikeRanges(
  source: Uint8Array,
  target: Uint8Array,
  blockSize: number = DEFAULT_BLOCK_SIZE,
): Generator<DeltaRange> {
  const index = buildSourceIndex(source, blockSize);
  const acc: RangeAccumulator = {};

  // No block possible => entire target is an insert
  if (target.length < blockSize || index.map.size === 0) {
    if (target.length > 0) {
      yield* emitRange(acc, {
        from: "target",
        start: 0,
        len: target.length,
      });
    }
    if (acc.last) {
      yield acc.last;
    }
    return;
  }

  let tPos = 0; // window start in target
  let insertStart = 0; // beginning of current unmatched region in target
  let rc: RollingChecksum | null = null;

  while (tPos + blockSize <= target.length) {
    // Initialize or slide checksum
    if (rc === null) {
      rc = rollingInit(target, tPos, blockSize);
    } else {
      const removeByte = target[tPos - 1];
      const addByte = target[tPos + blockSize - 1];
      rollingSlide(rc, removeByte, addByte);
    }

    const weak = rollingValue(rc);
    const candidates = index.map.get(weak);

    let bestSrcPos = -1;
    let bestTgtPos = tPos;
    let bestLen = 0;

    if (candidates && candidates.length > 0) {
      const targetStrong = strongChecksum(target, tPos, blockSize);

      for (const cand of candidates) {
        if (cand.strong !== targetStrong) continue;

        // We have a candidate block with matching weak + strong.
        let s = cand.pos;
        let tt = tPos;

        // Extend backward (but not before insertStart to avoid overlap)
        while (s > 0 && tt > insertStart && source[s - 1] === target[tt - 1]) {
          s--;
          tt--;
        }

        // Extend match forward as far as possible.
        let len = 0;
        while (
          s + len < source.length &&
          tt + len < target.length &&
          source[s + len] === target[tt + len]
        ) {
          len++;
        }

        if (len > bestLen) {
          bestLen = len;
          bestSrcPos = s;
          bestTgtPos = tt;
        }
      }
    }

    // Decide whether to take the match
    if (bestLen >= blockSize) {
      // Flush pending target-only bytes before the match
      if (bestTgtPos > insertStart) {
        yield* emitRange(acc, {
          from: "target",
          start: insertStart,
          len: bestTgtPos - insertStart,
        });
      }

      // Emit copy from source
      yield* emitRange(acc, {
        from: "source",
        start: bestSrcPos,
        len: bestLen,
      });

      // Advance past the match
      const newTPos = bestTgtPos + bestLen;
      tPos = newTPos;
      insertStart = newTPos;
      rc = null; // force re-init at the new window position
    } else {
      // No good match, move window by 1 byte
      tPos++;
      // rc stays in place and will be slid next iteration
    }
  }

  // Remaining tail of target that couldn't form a full block window
  if (insertStart < target.length) {
    yield* emitRange(acc, {
      from: "target",
      start: insertStart,
      len: target.length - insertStart,
    });
  }

  // Flush the final accumulated range
  if (acc.last) {
    yield acc.last;
  }
}
