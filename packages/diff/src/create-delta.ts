import { createDeltaRanges } from "./create-delta-ranges.js";
import type { Delta } from "./types.js";

export function* createDelta(
  source: Uint8Array,
  target: Uint8Array,
  blockSize = 16,
  minMatch = 16,
): Generator<Delta> {
  for (const r of createDeltaRanges(source, target, blockSize, minMatch)) {
    if (r.from === "source") {
      // COPY from source
      yield {
        start: r.start,
        len: r.len,
      };
    } else {
      // LITERAL bytes from target
      yield {
        data: target.subarray(r.start, r.start + r.len),
      };
    }
  }
}
