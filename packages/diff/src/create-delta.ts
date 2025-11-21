import { Checksum } from "./checksum-obj.js";
import { createDeltaRanges } from "./create-delta-ranges.js";
import type { Delta } from "./types.js";

export function* createDelta(
  source: Uint8Array,
  target: Uint8Array,
  blockSize = 16,
  minMatch = 16,
): Generator<Delta> {
  const checksumObj = new Checksum();
  yield {
    type: "start",
    targetLen: target.length,
  };
  for (const r of createDeltaRanges(source, target, blockSize, minMatch)) {
    if (r.from === "source") {
      // COPY from source
      checksumObj.update(source.subarray(r.start, r.start + r.len), 0, r.len);
      yield {
        type: "copy",
        start: r.start,
        len: r.len,
      };
    } else {
      // LITERAL bytes from target
      const chunk = target.subarray(r.start, r.start + r.len);
      checksumObj.update(chunk, 0, chunk.length);
      yield {
        type: "insert",
        data: chunk,
      };
    }
  }

  // Yield checksum as the last message
  yield {
    type: "finish",
    checksum: checksumObj.finalize(),
  };
}
