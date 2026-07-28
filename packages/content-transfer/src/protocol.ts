/**
 * Wire framing for the content-transfer RPC. One {@link Duplex} call carries one
 * request→response. Every message is `[4-byte big-endian header length][header
 * JSON][body bytes...]`: the JSON header names the op and its scalar args, and
 * the remaining bytes are the streamed body (a chunk's bytes, or none).
 *
 * Small op surface, one per content-store transfer primitive:
 *   - `capabilities`  → protocol handshake (BATCHED handshake, no body)
 *   - `getManifest`   → object recipe (needed for the download direction)
 *   - `hasChunks`     → BATCHED: many ids per request → the missing ids
 *   - `getChunk`      → STREAMED: response body is the chunk bytes
 *   - `putChunk`      → STREAMED: request body is the chunk bytes
 *   - `putManifest`   → server-side assemble from already-present chunks
 *
 * (A Bloom prefilter for `hasChunks` is intentionally deferred — the plain
 * batched id list is enough; add it only when a payload budget demands it.)
 */

import type { ChunkId, ObjectDescriptor, ObjectId } from "@statewalker/content-store";

export type Request =
  | { op: "capabilities" }
  | { op: "getManifest"; id: ObjectId }
  | { op: "hasChunks"; ids: ChunkId[] }
  | { op: "getChunk"; id: ChunkId }
  | { op: "putChunk"; id: ChunkId }
  | { op: "putManifest"; manifest: ObjectDescriptor };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encode `[len][header][body?]` as a byte stream. */
export async function* frameMessage(
  header: unknown,
  body?: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const json = encoder.encode(JSON.stringify(header));
  const prefix = new Uint8Array(4);
  prefix[0] = (json.length >>> 24) & 0xff;
  prefix[1] = (json.length >>> 16) & 0xff;
  prefix[2] = (json.length >>> 8) & 0xff;
  prefix[3] = json.length & 0xff;
  yield prefix;
  yield json;
  if (body) for await (const b of body) if (b.byteLength) yield b;
}

/** Read one framed message: its parsed header + a body byte stream. Accepts
 * either side of a {@link Duplex} (sync or async byte iterable). */
export async function readFrame<H>(
  input: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<{ header: H; body: AsyncGenerator<Uint8Array> }> {
  const iter: AsyncIterator<Uint8Array> =
    Symbol.asyncIterator in input
      ? input[Symbol.asyncIterator]()
      : (() => {
          const sync = input[Symbol.iterator]();
          return { next: async () => sync.next() };
        })();
  let buf = new Uint8Array(0);

  async function fill(n: number): Promise<void> {
    while (buf.length < n) {
      const { value, done } = await iter.next();
      if (done) throw new Error("content-transfer protocol: unexpected end of stream");
      const next = new Uint8Array(buf.length + value.length);
      next.set(buf, 0);
      next.set(value, buf.length);
      buf = next;
    }
  }

  await fill(4);
  const headerLen = ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
  await fill(4 + headerLen);
  const header = JSON.parse(decoder.decode(buf.subarray(4, 4 + headerLen))) as H;
  const rest = buf.subarray(4 + headerLen);

  async function* body(): AsyncGenerator<Uint8Array> {
    if (rest.byteLength) yield rest;
    while (true) {
      const { value, done } = await iter.next();
      if (done) return;
      if (value.byteLength) yield value;
    }
  }

  return { header, body: body() };
}
