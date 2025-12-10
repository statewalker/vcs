import {
  applyDelta as applyDeltaInternal,
  createDelta,
  createDeltaRanges,
  type Delta,
} from "@webrun-vcs/utils";
import type {
  DeltaComputeOptions,
  DeltaComputeResult,
  DeltaComputeStrategy,
} from "../../interfaces/index.js";

const DEFAULT_MIN_SIZE = 50;
const DEFAULT_MAX_RATIO = 0.75;

/**
 * Rolling hash delta computation strategy
 *
 * Uses rolling hash algorithm to find copy regions between base and target.
 * Produces format-agnostic Delta[] instructions that can be serialized
 * to Git format, stored in SQL, etc.
 *
 * Based on the same algorithm used by Git and Fossil VCS.
 */
export class RollingHashDeltaStrategy implements DeltaComputeStrategy {
  readonly name = "rolling-hash";

  computeDelta(
    base: Uint8Array,
    target: Uint8Array,
    options?: DeltaComputeOptions,
  ): DeltaComputeResult | null {
    const minSize = options?.minSize ?? DEFAULT_MIN_SIZE;
    const maxRatio = options?.maxRatio ?? DEFAULT_MAX_RATIO;

    // Skip small objects
    if (target.length < minSize) {
      return null;
    }

    // Compute delta ranges using rolling hash
    const ranges = createDeltaRanges(base, target);

    // Convert ranges to Delta[] instructions
    const delta = [...createDelta(base, target, ranges)];

    // Estimate size and check if delta is beneficial
    const estimatedSize = this.estimateSize(delta);
    const ratio = estimatedSize / target.length;

    if (ratio >= maxRatio) {
      return null;
    }

    return {
      delta,
      ratio,
      targetSize: target.length,
      baseSize: base.length,
    };
  }

  applyDelta(base: Uint8Array, delta: Iterable<Delta>): Uint8Array {
    // Collect chunks from generator
    const chunks: Uint8Array[] = [];
    for (const chunk of applyDeltaInternal(base, delta)) {
      chunks.push(chunk);
    }
    return concatBytes(...chunks);
  }

  estimateSize(delta: Iterable<Delta>): number {
    let size = 0;
    for (const d of delta) {
      switch (d.type) {
        case "start":
          // varint for target length (max 5 bytes for 32-bit int)
          size += 5;
          break;
        case "copy":
          // Git format: 1 cmd byte + up to 4 offset bytes + up to 3 size bytes
          size += 1 + 4 + 3;
          break;
        case "insert":
          // Git format: 1 length byte (max 127) + data bytes
          // For larger inserts, multiple instructions are needed
          size += Math.ceil(d.data.length / 127) + d.data.length;
          break;
        case "finish":
          // Checksum (4 bytes)
          size += 4;
          break;
      }
    }
    return size;
  }
}

/**
 * Concatenate multiple Uint8Arrays into one
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
