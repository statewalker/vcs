import { FossilChecksum } from "@webrun-vcs/hash/fossil-checksum";
import type { Delta } from "./types.js";

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
