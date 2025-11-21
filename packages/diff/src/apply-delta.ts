import type { Delta } from "./types.js";

export function* applyDelta(source: Uint8Array, deltas: Iterable<Delta>): Generator<Uint8Array> {
  for (const d of deltas) {
    if ("data" in d) {
      // Literal block
      yield d.data;
    } else {
      // Copy from source
      yield source.subarray(d.start, d.start + d.len);
    }
  }
}
