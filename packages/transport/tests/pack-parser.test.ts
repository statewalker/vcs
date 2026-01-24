/**
 * Pack Parser Specification Tests
 *
 * These tests document the Git pack file format and parsing behavior.
 * Pack parsing is delegated to the repository layer, not the transport layer.
 * The transport layer receives raw pack bytes and passes them to repository.importPack().
 *
 * Functionality covered:
 * - Pack header parsing
 * - Object type detection
 * - Delta object handling
 * - Checksum validation
 * - Corruption detection
 *
 * STATUS: Specification/documentation tests - pack parsing is handled by the
 *         repository layer (external to transport). These tests document the
 *         pack format for reference.
 *
 * Modeled after JGit's PackParserTest.java
 */

import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Pack File Types
// ─────────────────────────────────────────────────────────────────────────────

type ObjectType = "commit" | "tree" | "blob" | "tag" | "ofs_delta" | "ref_delta";

interface PackHeader {
  magic: string;
  version: number;
  objectCount: number;
}

interface PackObject {
  type: ObjectType;
  size: number;
  data: Uint8Array;
  // For delta objects
  baseOid?: string; // REF_DELTA
  baseOffset?: number; // OFS_DELTA
}

// Object type codes in pack format
const OBJECT_TYPE_COMMIT = 1;
const OBJECT_TYPE_TREE = 2;
const OBJECT_TYPE_BLOB = 3;
const OBJECT_TYPE_TAG = 4;
const OBJECT_TYPE_OFS_DELTA = 6;
const OBJECT_TYPE_REF_DELTA = 7;

// ─────────────────────────────────────────────────────────────────────────────
// Pack Parser Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses pack file header.
 * Format: "PACK" (4 bytes) + version (4 bytes BE) + object count (4 bytes BE)
 */
function parsePackHeader(data: Uint8Array): PackHeader {
  if (data.length < 12) {
    throw new Error("Pack header too short");
  }

  // Check magic
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== "PACK") {
    throw new Error(`Invalid pack magic: ${magic}`);
  }

  // Parse version (big-endian)
  const version = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
  if (version !== 2 && version !== 3) {
    throw new Error(`Unsupported pack version: ${version}`);
  }

  // Parse object count (big-endian)
  const objectCount = (data[8] << 24) | (data[9] << 16) | (data[10] << 8) | data[11];

  return { magic, version, objectCount };
}

/**
 * Gets object type name from type code.
 */
function getObjectTypeName(typeCode: number): ObjectType {
  switch (typeCode) {
    case OBJECT_TYPE_COMMIT:
      return "commit";
    case OBJECT_TYPE_TREE:
      return "tree";
    case OBJECT_TYPE_BLOB:
      return "blob";
    case OBJECT_TYPE_TAG:
      return "tag";
    case OBJECT_TYPE_OFS_DELTA:
      return "ofs_delta";
    case OBJECT_TYPE_REF_DELTA:
      return "ref_delta";
    default:
      throw new Error(`Unknown object type: ${typeCode}`);
  }
}

/**
 * Parses object header from pack data.
 * Returns type code and uncompressed size.
 */
function parseObjectHeader(
  data: Uint8Array,
  offset: number,
): { type: number; size: number; headerLength: number } {
  let byte = data[offset];
  const type = (byte >> 4) & 0x07;
  let size = byte & 0x0f;
  let shift = 4;
  let headerLength = 1;

  while (byte & 0x80) {
    byte = data[offset + headerLength];
    size |= (byte & 0x7f) << shift;
    shift += 7;
    headerLength++;
  }

  return { type, size, headerLength };
}

/**
 * Validates pack checksum.
 */
function validatePackChecksum(packData: Uint8Array): boolean {
  if (packData.length < 32) return false; // header + at least one checksum

  // Last 20 bytes are the checksum
  const checksumStart = packData.length - 20;
  const storedChecksum = Array.from(packData.slice(checksumStart))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // In mock, we just check format (real implementation would verify SHA-1)
  // Real implementation would: calculateChecksum(packData.slice(0, checksumStart))
  return storedChecksum.length === 40;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pack Header Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("PackParser", () => {
  describe("should parse pack header", () => {
    it("parses valid version 2 header", () => {
      const packData = new Uint8Array([
        0x50,
        0x41,
        0x43,
        0x4b, // "PACK"
        0x00,
        0x00,
        0x00,
        0x02, // version 2
        0x00,
        0x00,
        0x00,
        0x05, // 5 objects
      ]);

      const header = parsePackHeader(packData);

      expect(header.magic).toBe("PACK");
      expect(header.version).toBe(2);
      expect(header.objectCount).toBe(5);
    });

    it("parses header with large object count", () => {
      const packData = new Uint8Array([
        0x50,
        0x41,
        0x43,
        0x4b, // "PACK"
        0x00,
        0x00,
        0x00,
        0x02, // version 2
        0x00,
        0x01,
        0x00,
        0x00, // 65536 objects
      ]);

      const header = parsePackHeader(packData);

      expect(header.objectCount).toBe(65536);
    });

    it("rejects invalid magic", () => {
      const packData = new Uint8Array([
        0x47,
        0x49,
        0x54,
        0x50, // "GITP" - wrong magic
        0x00,
        0x00,
        0x00,
        0x02,
        0x00,
        0x00,
        0x00,
        0x01,
      ]);

      expect(() => parsePackHeader(packData)).toThrow("Invalid pack magic");
    });

    it("rejects unsupported version", () => {
      const packData = new Uint8Array([
        0x50,
        0x41,
        0x43,
        0x4b, // "PACK"
        0x00,
        0x00,
        0x00,
        0x04, // version 4 - unsupported
        0x00,
        0x00,
        0x00,
        0x01,
      ]);

      expect(() => parsePackHeader(packData)).toThrow("Unsupported pack version");
    });

    it("rejects truncated header", () => {
      const packData = new Uint8Array([
        0x50,
        0x41,
        0x43,
        0x4b, // "PACK" only
      ]);

      expect(() => parsePackHeader(packData)).toThrow("too short");
    });
  });

  describe("should parse commit objects", () => {
    it("identifies commit type", () => {
      const typeName = getObjectTypeName(OBJECT_TYPE_COMMIT);
      expect(typeName).toBe("commit");
    });

    it("parses commit object header", () => {
      // Type 1 (commit), size 156
      // Encoded: type in bits 4-6, size in lower bits
      const objectData = new Uint8Array([
        0x19, // type=1 (commit), size low bits = 9
        0x01, // size continuation = 1 (total size = 9 + (1 << 4) = 25)
      ]);

      const { type, size } = parseObjectHeader(objectData, 0);

      expect(type).toBe(OBJECT_TYPE_COMMIT);
      expect(size).toBeGreaterThan(0);
    });
  });

  describe("should parse tree objects", () => {
    it("identifies tree type", () => {
      const typeName = getObjectTypeName(OBJECT_TYPE_TREE);
      expect(typeName).toBe("tree");
    });
  });

  describe("should parse blob objects", () => {
    it("identifies blob type", () => {
      const typeName = getObjectTypeName(OBJECT_TYPE_BLOB);
      expect(typeName).toBe("blob");
    });

    it("handles small blob", () => {
      // Type 3 (blob), size 5
      const objectData = new Uint8Array([
        0x35, // type=3 (blob), size=5
      ]);

      const { type, size } = parseObjectHeader(objectData, 0);

      expect(type).toBe(OBJECT_TYPE_BLOB);
      expect(size).toBe(5);
    });
  });

  describe("should parse tag objects", () => {
    it("identifies tag type", () => {
      const typeName = getObjectTypeName(OBJECT_TYPE_TAG);
      expect(typeName).toBe("tag");
    });
  });

  describe("should parse OFS_DELTA objects", () => {
    it("identifies OFS_DELTA type", () => {
      const typeName = getObjectTypeName(OBJECT_TYPE_OFS_DELTA);
      expect(typeName).toBe("ofs_delta");
    });

    it("stores base offset for OFS_DELTA", () => {
      const deltaObject: PackObject = {
        type: "ofs_delta",
        size: 100,
        data: new Uint8Array(0),
        baseOffset: 1234,
      };

      expect(deltaObject.baseOffset).toBe(1234);
    });
  });

  describe("should parse REF_DELTA objects", () => {
    it("identifies REF_DELTA type", () => {
      const typeName = getObjectTypeName(OBJECT_TYPE_REF_DELTA);
      expect(typeName).toBe("ref_delta");
    });

    it("stores base OID for REF_DELTA", () => {
      const baseOid = "abc123".padEnd(40, "0");
      const deltaObject: PackObject = {
        type: "ref_delta",
        size: 100,
        data: new Uint8Array(0),
        baseOid,
      };

      expect(deltaObject.baseOid).toBe(baseOid);
    });
  });

  describe("should validate pack checksum", () => {
    it("validates checksum format", () => {
      // Create minimal pack with checksum
      const packContent = new Uint8Array([
        0x50,
        0x41,
        0x43,
        0x4b, // "PACK"
        0x00,
        0x00,
        0x00,
        0x02, // version 2
        0x00,
        0x00,
        0x00,
        0x00, // 0 objects
        // 20-byte SHA-1 checksum (mock)
        ...new Array(20).fill(0xab),
      ]);

      const isValid = validatePackChecksum(packContent);

      expect(isValid).toBe(true);
    });

    it("rejects pack without checksum", () => {
      const packContent = new Uint8Array([
        0x50, 0x41, 0x43, 0x4b, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00,
        0x00,
        // No checksum
      ]);

      const isValid = validatePackChecksum(packContent);

      expect(isValid).toBe(false);
    });
  });

  describe("should detect corruption", () => {
    it("detects corrupted magic bytes", () => {
      const corruptedPack = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x00, // Corrupted magic
        0x00,
        0x00,
        0x00,
        0x02,
        0x00,
        0x00,
        0x00,
        0x01,
      ]);

      expect(() => parsePackHeader(corruptedPack)).toThrow();
    });

    it("detects invalid object type", () => {
      expect(() => getObjectTypeName(0)).toThrow("Unknown object type");
      expect(() => getObjectTypeName(5)).toThrow("Unknown object type");
      expect(() => getObjectTypeName(8)).toThrow("Unknown object type");
    });
  });

  describe("should handle thin packs", () => {
    it("recognizes thin pack indicator", () => {
      // Thin packs contain REF_DELTA objects with external bases
      const thinPackIndicators = {
        hasExternalBase: true,
        externalBaseOid: "abc123".padEnd(40, "0"),
      };

      expect(thinPackIndicators.hasExternalBase).toBe(true);
    });

    it("tracks missing bases for thin packs", () => {
      const missingBases = new Set<string>();

      // Simulate finding REF_DELTA with unknown base
      const externalOid = "unknown".padEnd(40, "0");
      missingBases.add(externalOid);

      expect(missingBases.size).toBe(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Variable-Length Integer Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Variable-Length Integer Encoding", () => {
  it("decodes single-byte size", () => {
    const data = new Uint8Array([0x35]); // type=3, size=5
    const { size } = parseObjectHeader(data, 0);

    expect(size).toBe(5);
  });

  it("decodes multi-byte size", () => {
    // Type 3 (blob), size needs continuation
    // First byte: continuation bit (0x80) + type (3<<4 = 0x30) + size low (0x0f) = 0xbf
    const data = new Uint8Array([
      0xbf, // continuation=1, type=3, size low = 15
      0x01, // continuation=0, adds 1 << 4 = 16
    ]);
    const { size, headerLength } = parseObjectHeader(data, 0);

    expect(headerLength).toBe(2);
    expect(size).toBe(15 + (1 << 4)); // 31
  });

  it("handles maximum single-byte size", () => {
    const data = new Uint8Array([0x3f]); // max without continuation
    const { size } = parseObjectHeader(data, 0);

    expect(size).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Object Entry Parsing Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack Object Entries", () => {
  it("calculates header length correctly", () => {
    const singleByte = new Uint8Array([0x35]);
    const { headerLength: len1 } = parseObjectHeader(singleByte, 0);
    expect(len1).toBe(1);

    const twoByte = new Uint8Array([0xbf, 0x01]);
    const { headerLength: len2 } = parseObjectHeader(twoByte, 0);
    expect(len2).toBe(2);
  });

  it("parses object at non-zero offset", () => {
    const data = new Uint8Array([
      0x00,
      0x00,
      0x00, // padding
      0x35, // object at offset 3
    ]);

    const { type, size } = parseObjectHeader(data, 3);

    expect(type).toBe(OBJECT_TYPE_BLOB);
    expect(size).toBe(5);
  });
});
