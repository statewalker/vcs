/**
 * Streaming pack writer
 *
 * Yields pack file chunks incrementally as objects are added,
 * instead of accumulating the entire pack in memory.
 *
 * Key difference from PackWriterStream: data flows out immediately
 * via async generators rather than being buffered internally.
 */

import { compressBlock } from "@statewalker/vcs-utils";
import { Sha1 } from "@statewalker/vcs-utils/hash/sha1";
import { hexToBytes } from "@statewalker/vcs-utils/hash/utils";
import { PackObjectType } from "./types.js";
import { writeOfsVarint, writePackHeader } from "./varint.js";

/** Pack file signature "PACK" */
const PACK_SIGNATURE = new Uint8Array([0x50, 0x41, 0x43, 0x4b]);

/** Pack version we generate */
const PACK_VERSION = 2;

/**
 * Encode a 32-bit unsigned integer to big-endian bytes
 */
function encodeUInt32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  bytes[0] = (value >>> 24) & 0xff;
  bytes[1] = (value >>> 16) & 0xff;
  bytes[2] = (value >>> 8) & 0xff;
  bytes[3] = value & 0xff;
  return bytes;
}

/**
 * Streaming pack writer that yields chunks as objects are added
 *
 * Usage:
 * ```ts
 * const writer = new StreamingPackWriter(3);
 * yield* writer.addObject(id1, type1, content1);
 * yield* writer.addObject(id2, type2, content2);
 * yield* writer.addRefDelta(id3, baseId, delta);
 * yield* writer.finalize();
 * ```
 *
 * The pack header (with object count) is emitted on the first `addObject` call.
 * Each `addObject`/`addRefDelta`/`addOfsDelta` call yields header + compressed chunks.
 * `finalize()` yields the 20-byte SHA-1 checksum.
 */
export class StreamingPackWriter {
  private readonly sha1 = new Sha1();
  private objectCount = 0;
  private headerSent = false;
  private finalized = false;
  private currentOffset = 0;
  private readonly objectOffsets = new Map<string, number>();

  constructor(private readonly expectedCount: number) {}

  /**
   * Add a whole object and yield its pack chunks
   */
  async *addObject(
    id: string,
    type: PackObjectType,
    content: Uint8Array,
  ): AsyncGenerator<Uint8Array> {
    this.ensureNotFinalized();
    yield* this.emitHeader();

    const entryOffset = this.currentOffset;
    this.objectOffsets.set(id, entryOffset);

    const header = writePackHeader(type, content.length);
    const compressed = await compressBlock(content, { raw: false });

    yield* this.emitChunk(header);
    yield* this.emitChunk(compressed);

    this.objectCount++;
  }

  /**
   * Add a REF_DELTA object and yield its pack chunks
   */
  async *addRefDelta(id: string, baseId: string, delta: Uint8Array): AsyncGenerator<Uint8Array> {
    this.ensureNotFinalized();
    yield* this.emitHeader();

    const entryOffset = this.currentOffset;
    this.objectOffsets.set(id, entryOffset);

    const header = writePackHeader(PackObjectType.REF_DELTA, delta.length);
    const baseIdBytes = hexToBytes(baseId);
    const compressed = await compressBlock(delta, { raw: false });

    yield* this.emitChunk(header);
    yield* this.emitChunk(baseIdBytes);
    yield* this.emitChunk(compressed);

    this.objectCount++;
  }

  /**
   * Add an OFS_DELTA object and yield its pack chunks
   *
   * The base object must have been added earlier via addObject/addRefDelta/addOfsDelta.
   */
  async *addOfsDelta(id: string, baseId: string, delta: Uint8Array): AsyncGenerator<Uint8Array> {
    this.ensureNotFinalized();
    yield* this.emitHeader();

    const baseOffset = this.objectOffsets.get(baseId);
    if (baseOffset === undefined) {
      throw new Error(`Base object ${baseId} not found in pack`);
    }

    const entryOffset = this.currentOffset;
    const negativeOffset = entryOffset - baseOffset;
    this.objectOffsets.set(id, entryOffset);

    const header = writePackHeader(PackObjectType.OFS_DELTA, delta.length);
    const offsetBytes = writeOfsVarint(negativeOffset);
    const compressed = await compressBlock(delta, { raw: false });

    yield* this.emitChunk(header);
    yield* this.emitChunk(offsetBytes);
    yield* this.emitChunk(compressed);

    this.objectCount++;
  }

  /**
   * Finalize the pack and yield the 20-byte SHA-1 checksum
   */
  async *finalize(): AsyncGenerator<Uint8Array> {
    this.ensureNotFinalized();

    // Emit header if no objects were added (empty pack)
    yield* this.emitHeader();

    if (this.objectCount !== this.expectedCount) {
      throw new Error(`Expected ${this.expectedCount} objects but wrote ${this.objectCount}`);
    }

    this.finalized = true;
    const checksum = this.sha1.finalize();
    yield checksum;
  }

  private ensureNotFinalized(): void {
    if (this.finalized) {
      throw new Error("Pack has been finalized");
    }
  }

  /**
   * Emit the 12-byte pack header on first call, noop on subsequent calls
   */
  private *emitHeader(): Generator<Uint8Array> {
    if (this.headerSent) return;
    this.headerSent = true;

    const header = new Uint8Array(12);
    header.set(PACK_SIGNATURE, 0);
    header.set(encodeUInt32(PACK_VERSION), 4);
    header.set(encodeUInt32(this.expectedCount), 8);

    this.sha1.update(header);
    this.currentOffset += header.length;
    yield header;
  }

  /**
   * Emit a chunk: update SHA-1 hash, track offset, and yield
   */
  private *emitChunk(chunk: Uint8Array): Generator<Uint8Array> {
    this.sha1.update(chunk);
    this.currentOffset += chunk.length;
    yield chunk;
  }
}
