import { createHash } from "node:crypto";
import type { ByteStream } from "../src/index.js";

/** Collect a byte stream into one contiguous Uint8Array (test-side only). */
export async function collect(stream: ByteStream): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const chunk of stream) parts.push(chunk);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Collect a byte stream and decode as UTF-8. */
export async function collectText(stream: ByteStream): Promise<string> {
  return new TextDecoder().decode(await collect(stream));
}

/** Build a byte stream from the given chunks. */
export async function* streamOf(...chunks: Array<Uint8Array | string>): ByteStream {
  for (const c of chunks) yield typeof c === "string" ? new TextEncoder().encode(c) : c;
}

export function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** SHA-256 hex over a byte stream — a plausible caller-supplied verify fn. */
export async function sha256(input: ByteStream): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of input) h.update(chunk);
  return h.digest("hex");
}
