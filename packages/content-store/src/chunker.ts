import type { ByteStream, CdcParams } from "./types.js";

/**
 * Minimal Gear-hash FastCDC content-defined chunker.
 *
 * A rolling Gear fingerprint (`fp = (fp << 1) + GEAR[byte]`) restarts at every
 * chunk boundary; a cut is taken when the low bits of `fp` are zero. Normalized
 * chunking (Xia et al., FastCDC) uses a stricter mask before the average size
 * and a looser one after, tightening the size distribution. Because the cut for
 * a chunk depends only on the bytes since its own start, boundaries re-sync
 * shortly after an edit — so a mid-file insert leaves surrounding chunks intact.
 */

const GEAR = buildGearTable();

/** 256 deterministic 32-bit gear values (xorshift32 from a fixed seed). */
function buildGearTable(): Uint32Array {
  const g = new Uint32Array(256);
  let x = 0x9e3779b9;
  for (let i = 0; i < 256; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    g[i] = x;
  }
  return g;
}

interface Masks {
  min: number;
  avg: number;
  max: number;
  maskS: number;
  maskL: number;
}

function masksFor(cdc: CdcParams): Masks {
  const bits = Math.round(Math.log2(cdc.avg));
  // Normalization = 2: harder mask (more low bits ⇒ rarer cut) before avg,
  // easier mask after, clamped so both stay valid low-bit masks.
  const maskS = (1 << Math.min(bits + 2, 31)) - 1;
  const maskL = (1 << Math.max(bits - 2, 1)) - 1;
  return { min: cdc.min, avg: cdc.avg, max: cdc.max, maskS, maskL };
}

/**
 * Find the cut index (exclusive end of the first chunk) within `buf`, whose
 * chunk starts at index 0. Returns `-1` when more bytes are needed before a cut
 * can be decided (only when `!final`).
 */
function findCut(buf: Uint8Array, m: Masks, final: boolean): number {
  const n = buf.length;
  if (n <= m.min) return final ? n : -1; // too small to cut yet
  const limit = Math.min(n, m.max);
  let fp = 0;
  let i = m.min;
  const avgStop = Math.min(m.avg, limit);
  for (; i < avgStop; i++) {
    fp = ((fp << 1) + GEAR[buf[i]]) >>> 0;
    if ((fp & m.maskS) === 0) return i;
  }
  for (; i < limit; i++) {
    fp = ((fp << 1) + GEAR[buf[i]]) >>> 0;
    if ((fp & m.maskL) === 0) return i;
  }
  if (limit === m.max) return m.max; // forced cut at max size
  return final ? n : -1; // remainder is a final chunk, or await more bytes
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Split `source` into content-defined chunks. Content strictly smaller than
 * `threshold` is emitted as a single direct blob (no CDC). Bounded memory: at
 * most one pending chunk (plus one incoming array) is buffered at a time.
 */
export async function* chunkContent(
  source: ByteStream,
  cdc: CdcParams,
  threshold: number,
): AsyncIterable<Uint8Array> {
  const iter = source[Symbol.asyncIterator]();

  // Buffer up to `threshold` bytes to decide direct-blob vs CDC.
  const prefix: Uint8Array[] = [];
  let prefixLen = 0;
  let done = false;
  while (prefixLen < threshold) {
    const next = await iter.next();
    if (next.done) {
      done = true;
      break;
    }
    prefix.push(next.value);
    prefixLen += next.value.length;
  }

  if (done && prefixLen < threshold) {
    // Whole content is below threshold → one direct blob.
    let blob = new Uint8Array(0);
    for (const p of prefix) blob = concat(blob, p);
    yield blob;
    return;
  }

  // At or above threshold → CDC over the buffered prefix, then the rest.
  const m = masksFor(cdc);
  let buf = new Uint8Array(0);
  const feed = async function* (): AsyncIterable<Uint8Array> {
    for (const p of prefix) yield p;
    if (!done) {
      for (let n = await iter.next(); !n.done; n = await iter.next()) yield n.value;
    }
  };

  for await (const incoming of feed()) {
    buf = concat(buf, incoming);
    for (let cut = findCut(buf, m, false); cut >= 0; cut = findCut(buf, m, false)) {
      yield buf.subarray(0, cut);
      buf = buf.subarray(cut);
    }
  }
  // Flush the tail.
  while (buf.length > 0) {
    let cut = findCut(buf, m, true);
    if (cut <= 0) cut = buf.length;
    yield buf.subarray(0, cut);
    buf = buf.subarray(cut);
  }
}
