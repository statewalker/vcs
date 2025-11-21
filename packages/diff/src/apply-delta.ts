import { Checksum } from "./checksum-obj.js";
import type { Delta } from "./types.js";

export function* applyDelta(source: Uint8Array, deltas: Iterable<Delta>): Generator<Uint8Array> {
  const checksumObj = new Checksum();
  let expectedChecksum: number | undefined;

  for (const d of deltas) {
    if ("checksum" in d) {
      // Last message contains the checksum
      expectedChecksum = d.checksum;
      break;
    }
    if ("data" in d) {
      // Literal block
      const chunk = d.data;
      if (chunk.length > 0) {
        checksumObj.update(chunk, 0, chunk.length);
        yield chunk;
      }
    } else {
      // Copy from source
      if (d.len > 0) {
        const chunk = source.subarray(d.start, d.start + d.len);
        checksumObj.update(chunk, 0, chunk.length);
        yield chunk;
      }
    }
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
