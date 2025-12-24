/**
 * Pack entries parser
 *
 * Parses pack data and yields entries with delta information preserved.
 * Unlike indexPack() which resolves deltas, this preserves the delta
 * relationships for re-import into delta storage.
 *
 * Based on pack-indexer.ts but designed for delta-aware import.
 */

import { type Delta, decompressBlockPartial, deserializeDeltaFromGit } from "@webrun-vcs/utils";
import { sha1 } from "@webrun-vcs/utils/hash/sha1";
import { bytesToHex } from "../utils/index.js";
import { applyDelta } from "./pack-reader.js";
import { PackObjectType } from "./types.js";

/** Pack file signature "PACK" */
const PACK_SIGNATURE = 0x5041434b;

/** SHA-1 hash size in bytes */
const OBJECT_ID_LENGTH = 20;

/**
 * Object type as string
 */
export type GitObjectType = "commit" | "tree" | "blob" | "tag";

/**
 * Base (non-delta) pack entry
 */
export interface BasePackEntry {
  type: "base";
  /** Object ID (SHA-1 hex) */
  id: string;
  /** Git object type */
  objectType: GitObjectType;
  /** Full object content */
  content: Uint8Array;
}

/**
 * Delta pack entry
 */
export interface DeltaPackEntry {
  type: "delta";
  /** Target object ID (SHA-1 hex) */
  id: string;
  /** Base object ID (SHA-1 hex) */
  baseId: string;
  /** Git object type (inherited from base) */
  objectType: GitObjectType;
  /** Delta instructions (format-agnostic) */
  delta: Delta[];
  /** Full resolved content (for verification) */
  content: Uint8Array;
}

/**
 * Pack entry (base or delta)
 */
export type PackEntry = BasePackEntry | DeltaPackEntry;

/**
 * Result of parsing pack entries
 */
export interface ParsePackEntriesResult {
  /** Pack version */
  version: number;
  /** Number of objects in pack */
  objectCount: number;
  /** SHA-1 checksum of pack */
  packChecksum: Uint8Array;
  /** Parsed entries */
  entries: PackEntry[];
}

/**
 * Parse pack data and return entries with delta information preserved.
 *
 * This function:
 * 1. Parses all pack objects
 * 2. Resolves deltas to compute object IDs
 * 3. Preserves delta instructions for re-import
 *
 * Entries are returned in dependency order (bases before deltas that reference them).
 *
 * @param packData Raw pack file bytes
 * @returns Parsed entries with delta information
 */
export async function parsePackEntries(packData: Uint8Array): Promise<ParsePackEntriesResult> {
  const reader = new PackDataReader(packData);
  const header = reader.readPackHeader();

  // Cache for resolved objects (needed for delta resolution)
  const objectCache = new Map<number, { type: PackObjectType; content: Uint8Array; id: string }>();
  const objectById = new Map<string, { type: PackObjectType; content: Uint8Array }>();

  const entries: PackEntry[] = [];
  let offset = 12; // Start after header

  for (let i = 0; i < header.objectCount; i++) {
    const entryStart = offset;

    // Read object header
    const objHeader = reader.readObjectHeader(offset);
    offset += objHeader.headerLength;

    // Read and decompress content
    const { decompressed, compressedLength } = await reader.decompressAt(offset, objHeader.size);
    offset += compressedLength;

    switch (objHeader.type) {
      case PackObjectType.COMMIT:
      case PackObjectType.TREE:
      case PackObjectType.BLOB:
      case PackObjectType.TAG: {
        // Base object
        const id = await computeObjectId(objHeader.type, decompressed);
        const objectType = packTypeToString(objHeader.type);

        objectCache.set(entryStart, { type: objHeader.type, content: decompressed, id });
        objectById.set(id, { type: objHeader.type, content: decompressed });

        entries.push({
          type: "base",
          id,
          objectType,
          content: decompressed,
        });
        break;
      }

      case PackObjectType.OFS_DELTA: {
        // Delta with offset-based base reference
        if (objHeader.baseOffset === undefined) {
          throw new Error(`OFS_DELTA at offset ${entryStart} missing base offset`);
        }

        const baseOffset = entryStart - objHeader.baseOffset;
        const base = objectCache.get(baseOffset);
        if (!base) {
          throw new Error(
            `OFS_DELTA at offset ${entryStart}: base at ${baseOffset} not found in cache`,
          );
        }

        // Resolve content to compute ID
        const content = applyDelta(base.content, decompressed);
        const id = await computeObjectId(base.type, content);
        const objectType = packTypeToString(base.type);

        // Convert Git binary delta to format-agnostic Delta[]
        const delta = deserializeDeltaFromGit(decompressed);

        objectCache.set(entryStart, { type: base.type, content, id });
        objectById.set(id, { type: base.type, content });

        entries.push({
          type: "delta",
          id,
          baseId: base.id,
          objectType,
          delta,
          content,
        });
        break;
      }

      case PackObjectType.REF_DELTA: {
        // Delta with SHA-1 based reference
        if (objHeader.baseId === undefined) {
          throw new Error(`REF_DELTA at offset ${entryStart} missing base ID`);
        }

        const base = objectById.get(objHeader.baseId);
        if (!base) {
          throw new Error(
            `REF_DELTA at offset ${entryStart}: base ${objHeader.baseId} not found. ` +
              `This may be a thin pack requiring external base objects.`,
          );
        }

        // Resolve content to compute ID
        const content = applyDelta(base.content, decompressed);
        const id = await computeObjectId(base.type, content);
        const objectType = packTypeToString(base.type);

        // Convert Git binary delta to format-agnostic Delta[]
        const delta = deserializeDeltaFromGit(decompressed);

        objectCache.set(entryStart, { type: base.type, content, id });
        objectById.set(id, { type: base.type, content });

        entries.push({
          type: "delta",
          id,
          baseId: objHeader.baseId,
          objectType,
          delta,
          content,
        });
        break;
      }

      default:
        throw new Error(`Unknown object type ${objHeader.type} at offset ${entryStart}`);
    }
  }

  // Extract pack checksum
  const packChecksum = packData.subarray(packData.length - OBJECT_ID_LENGTH);

  return {
    version: header.version,
    objectCount: header.objectCount,
    packChecksum,
    entries,
  };
}

/**
 * Async generator version of parsePackEntries for streaming.
 *
 * Yields entries one at a time, which is more memory-efficient
 * for large packs.
 */
export async function* parsePackEntriesStream(packData: Uint8Array): AsyncGenerator<PackEntry> {
  const result = await parsePackEntries(packData);
  for (const entry of result.entries) {
    yield entry;
  }
}

/**
 * Compute object ID (SHA-1 of "type size\0content")
 */
async function computeObjectId(type: PackObjectType, content: Uint8Array): Promise<string> {
  const typeStr = packTypeToString(type);
  const header = new TextEncoder().encode(`${typeStr} ${content.length}\0`);

  const fullData = new Uint8Array(header.length + content.length);
  fullData.set(header, 0);
  fullData.set(content, header.length);

  const hash = await sha1(fullData);
  return bytesToHex(hash);
}

/**
 * Convert pack object type to string
 */
function packTypeToString(type: PackObjectType): GitObjectType {
  switch (type) {
    case PackObjectType.COMMIT:
      return "commit";
    case PackObjectType.TREE:
      return "tree";
    case PackObjectType.BLOB:
      return "blob";
    case PackObjectType.TAG:
      return "tag";
    default:
      throw new Error(`Unknown object type: ${type}`);
  }
}

/**
 * In-memory pack data reader
 */
class PackDataReader {
  private readonly data: Uint8Array;
  private readonly view: DataView;

  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  readPackHeader(): { version: number; objectCount: number } {
    if (this.data.length < 12) {
      throw new Error("Pack data too short for header");
    }

    const signature = this.view.getUint32(0, false);
    if (signature !== PACK_SIGNATURE) {
      throw new Error(`Invalid pack signature: 0x${signature.toString(16)}`);
    }

    const version = this.view.getUint32(4, false);
    if (version !== 2 && version !== 3) {
      throw new Error(`Unsupported pack version: ${version}`);
    }

    const objectCount = this.view.getUint32(8, false);
    return { version, objectCount };
  }

  readObjectHeader(offset: number): {
    type: PackObjectType;
    size: number;
    baseOffset?: number;
    baseId?: string;
    headerLength: number;
  } {
    let pos = offset;

    let c = this.data[pos++];
    const type = ((c >> 4) & 0x07) as PackObjectType;
    let size = c & 0x0f;
    let shift = 4;

    while ((c & 0x80) !== 0) {
      c = this.data[pos++];
      size |= (c & 0x7f) << shift;
      shift += 7;
    }

    let headerLength = pos - offset;
    let baseOffset: number | undefined;
    let baseId: string | undefined;

    if (type === PackObjectType.OFS_DELTA) {
      c = this.data[pos++];
      baseOffset = c & 0x7f;
      while ((c & 0x80) !== 0) {
        baseOffset++;
        c = this.data[pos++];
        baseOffset <<= 7;
        baseOffset += c & 0x7f;
      }
      headerLength = pos - offset;
    } else if (type === PackObjectType.REF_DELTA) {
      baseId = bytesToHex(this.data.subarray(pos, pos + OBJECT_ID_LENGTH));
      pos += OBJECT_ID_LENGTH;
      headerLength = pos - offset;
    }

    return { type, size, baseOffset, baseId, headerLength };
  }

  async decompressAt(
    offset: number,
    expectedSize: number,
  ): Promise<{ decompressed: Uint8Array; compressedLength: number }> {
    const compressed = this.data.subarray(offset, this.data.length - 20);
    const result = await decompressBlockPartial(compressed, { raw: false });

    if (result.data.length !== expectedSize) {
      throw new Error(
        `Decompression size mismatch: expected ${expectedSize}, got ${result.data.length}`,
      );
    }

    return { decompressed: result.data, compressedLength: result.bytesRead };
  }
}
