import { describe, expect, it } from "vitest";
import {
  concatArrays,
  encodeHeader,
  ObjectType,
  type ObjectTypeCode,
  parseHeader,
  parseHeaderFromStream,
  prependChunk,
  stringToType,
  typeToString,
} from "../../src/storage-git/git-format.js";

describe("git-format", () => {
  describe("ObjectType constants", () => {
    it("should have correct type codes matching Git/JGit", () => {
      expect(ObjectType.COMMIT).toBe(1);
      expect(ObjectType.TREE).toBe(2);
      expect(ObjectType.BLOB).toBe(3);
      expect(ObjectType.TAG).toBe(4);
    });
  });

  describe("typeToString", () => {
    it("should convert COMMIT to 'commit'", () => {
      expect(typeToString(ObjectType.COMMIT)).toBe("commit");
    });

    it("should convert TREE to 'tree'", () => {
      expect(typeToString(ObjectType.TREE)).toBe("tree");
    });

    it("should convert BLOB to 'blob'", () => {
      expect(typeToString(ObjectType.BLOB)).toBe("blob");
    });

    it("should convert TAG to 'tag'", () => {
      expect(typeToString(ObjectType.TAG)).toBe("tag");
    });

    it("should throw for invalid type code", () => {
      expect(() => typeToString(99 as ObjectTypeCode)).toThrow("Invalid Git object type code: 99");
    });

    it("should throw for zero type code", () => {
      expect(() => typeToString(0 as ObjectTypeCode)).toThrow("Invalid Git object type code: 0");
    });
  });

  describe("stringToType", () => {
    it("should convert 'commit' to COMMIT", () => {
      expect(stringToType("commit")).toBe(ObjectType.COMMIT);
    });

    it("should convert 'tree' to TREE", () => {
      expect(stringToType("tree")).toBe(ObjectType.TREE);
    });

    it("should convert 'blob' to BLOB", () => {
      expect(stringToType("blob")).toBe(ObjectType.BLOB);
    });

    it("should convert 'tag' to TAG", () => {
      expect(stringToType("tag")).toBe(ObjectType.TAG);
    });

    it("should throw for invalid type string", () => {
      expect(() => stringToType("invalid")).toThrow("Invalid Git object type: invalid");
    });

    it("should throw for empty string", () => {
      expect(() => stringToType("")).toThrow("Invalid Git object type: ");
    });

    it("should throw for uppercase type strings", () => {
      expect(() => stringToType("BLOB")).toThrow("Invalid Git object type: BLOB");
    });

    it("should throw for mixed case type strings", () => {
      expect(() => stringToType("Commit")).toThrow("Invalid Git object type: Commit");
    });
  });

  describe("encodeHeader", () => {
    it("should encode blob header correctly", () => {
      const header = encodeHeader(ObjectType.BLOB, 13);
      const decoded = new TextDecoder().decode(header);
      expect(decoded).toBe("blob 13\0");
    });

    it("should encode commit header correctly", () => {
      const header = encodeHeader(ObjectType.COMMIT, 256);
      const decoded = new TextDecoder().decode(header);
      expect(decoded).toBe("commit 256\0");
    });

    it("should encode tree header correctly", () => {
      const header = encodeHeader(ObjectType.TREE, 0);
      const decoded = new TextDecoder().decode(header);
      expect(decoded).toBe("tree 0\0");
    });

    it("should encode tag header correctly", () => {
      const header = encodeHeader(ObjectType.TAG, 1000000);
      const decoded = new TextDecoder().decode(header);
      expect(decoded).toBe("tag 1000000\0");
    });

    it("should include null terminator", () => {
      const header = encodeHeader(ObjectType.BLOB, 5);
      expect(header[header.length - 1]).toBe(0);
    });

    it("should handle large sizes", () => {
      const header = encodeHeader(ObjectType.BLOB, 999999999);
      const decoded = new TextDecoder().decode(header);
      expect(decoded).toBe("blob 999999999\0");
    });
  });

  describe("parseHeader", () => {
    it("should parse blob header", () => {
      const data = new TextEncoder().encode("blob 13\0Hello, World!");
      const result = parseHeader(data);
      expect(result.type).toBe(ObjectType.BLOB);
      expect(result.size).toBe(13);
      expect(result.contentOffset).toBe(8);
    });

    it("should parse commit header", () => {
      const data = new TextEncoder().encode("commit 256\0content here");
      const result = parseHeader(data);
      expect(result.type).toBe(ObjectType.COMMIT);
      expect(result.size).toBe(256);
      expect(result.contentOffset).toBe(11);
    });

    it("should parse tree header", () => {
      const data = new TextEncoder().encode("tree 0\0");
      const result = parseHeader(data);
      expect(result.type).toBe(ObjectType.TREE);
      expect(result.size).toBe(0);
      expect(result.contentOffset).toBe(7);
    });

    it("should parse tag header", () => {
      const data = new TextEncoder().encode("tag 1234567890\0tag content");
      const result = parseHeader(data);
      expect(result.type).toBe(ObjectType.TAG);
      expect(result.size).toBe(1234567890);
      expect(result.contentOffset).toBe(15);
    });

    it("should throw for missing null terminator", () => {
      const data = new TextEncoder().encode("blob 13");
      expect(() => parseHeader(data)).toThrow("Invalid Git object: no header terminator found");
    });

    it("should throw for missing space separator", () => {
      const data = new TextEncoder().encode("blob13\0content");
      expect(() => parseHeader(data)).toThrow("Invalid Git object header: missing space separator");
    });

    it("should throw for invalid type", () => {
      const data = new TextEncoder().encode("invalid 13\0content");
      expect(() => parseHeader(data)).toThrow("Invalid Git object type: invalid");
    });

    it("should throw for negative size", () => {
      const data = new TextEncoder().encode("blob -5\0content");
      expect(() => parseHeader(data)).toThrow("Invalid Git object size: -5");
    });

    it("should throw for non-numeric size", () => {
      const data = new TextEncoder().encode("blob abc\0content");
      expect(() => parseHeader(data)).toThrow("Invalid Git object size: abc");
    });

    it("should correctly calculate content offset", () => {
      // "blob 5\0" = 7 bytes, so content starts at offset 7
      const data = new TextEncoder().encode("blob 5\0hello");
      const result = parseHeader(data);
      expect(result.contentOffset).toBe(7);

      // Verify content extraction works
      const content = new TextDecoder().decode(data.subarray(result.contentOffset));
      expect(content).toBe("hello");
    });
  });

  describe("concatArrays", () => {
    it("should concatenate multiple arrays", () => {
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([4, 5]);
      const c = new Uint8Array([6, 7, 8, 9]);
      const result = concatArrays([a, b, c]);
      expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("should handle empty arrays", () => {
      const a = new Uint8Array([1, 2]);
      const b = new Uint8Array([]);
      const c = new Uint8Array([3, 4]);
      const result = concatArrays([a, b, c]);
      expect(Array.from(result)).toEqual([1, 2, 3, 4]);
    });

    it("should handle single array", () => {
      const a = new Uint8Array([1, 2, 3]);
      const result = concatArrays([a]);
      expect(Array.from(result)).toEqual([1, 2, 3]);
    });

    it("should handle empty input", () => {
      const result = concatArrays([]);
      expect(result.length).toBe(0);
    });

    it("should handle all empty arrays", () => {
      const result = concatArrays([new Uint8Array([]), new Uint8Array([])]);
      expect(result.length).toBe(0);
    });
  });

  describe("prependChunk", () => {
    it("should prepend chunk to stream", async () => {
      const chunk = new Uint8Array([1, 2, 3]);
      const stream = (async function* () {
        yield new Uint8Array([4, 5]);
        yield new Uint8Array([6, 7, 8]);
      })();

      const chunks: Uint8Array[] = [];
      for await (const c of prependChunk(chunk, stream)) {
        chunks.push(c);
      }

      expect(chunks.length).toBe(3);
      expect(Array.from(chunks[0])).toEqual([1, 2, 3]);
      expect(Array.from(chunks[1])).toEqual([4, 5]);
      expect(Array.from(chunks[2])).toEqual([6, 7, 8]);
    });

    it("should skip empty prepended chunk", async () => {
      const chunk = new Uint8Array([]);
      const stream = (async function* () {
        yield new Uint8Array([1, 2, 3]);
      })();

      const chunks: Uint8Array[] = [];
      for await (const c of prependChunk(chunk, stream)) {
        chunks.push(c);
      }

      expect(chunks.length).toBe(1);
      expect(Array.from(chunks[0])).toEqual([1, 2, 3]);
    });

    it("should work with empty stream", async () => {
      const chunk = new Uint8Array([1, 2]);
      const stream = (async function* (): AsyncIterable<Uint8Array> {
        // Empty stream
      })();

      const chunks: Uint8Array[] = [];
      for await (const c of prependChunk(chunk, stream)) {
        chunks.push(c);
      }

      expect(chunks.length).toBe(1);
      expect(Array.from(chunks[0])).toEqual([1, 2]);
    });
  });

  describe("parseHeaderFromStream", () => {
    it("should parse header from single chunk stream", async () => {
      const data = new TextEncoder().encode("blob 5\0hello");
      const stream = (async function* () {
        yield data;
      })();

      const result = await parseHeaderFromStream(stream);
      expect(result.type).toBe(ObjectType.BLOB);
      expect(result.size).toBe(5);

      // Collect content
      const contentChunks: Uint8Array[] = [];
      for await (const chunk of result.content) {
        contentChunks.push(chunk);
      }
      const content = concatArrays(contentChunks);
      expect(new TextDecoder().decode(content)).toBe("hello");
    });

    it("should parse header from multi-chunk stream", async () => {
      const stream = (async function* () {
        yield new TextEncoder().encode("blo");
        yield new TextEncoder().encode("b 1");
        yield new TextEncoder().encode("3\0Hello, World!");
      })();

      const result = await parseHeaderFromStream(stream);
      expect(result.type).toBe(ObjectType.BLOB);
      expect(result.size).toBe(13);

      const contentChunks: Uint8Array[] = [];
      for await (const chunk of result.content) {
        contentChunks.push(chunk);
      }
      const content = concatArrays(contentChunks);
      expect(new TextDecoder().decode(content)).toBe("Hello, World!");
    });

    it("should handle header split across chunks", async () => {
      const stream = (async function* () {
        yield new TextEncoder().encode("comm");
        yield new TextEncoder().encode("it 10\0");
        yield new TextEncoder().encode("0123456789");
      })();

      const result = await parseHeaderFromStream(stream);
      expect(result.type).toBe(ObjectType.COMMIT);
      expect(result.size).toBe(10);
    });

    it("should handle null terminator at chunk boundary", async () => {
      const stream = (async function* () {
        yield new TextEncoder().encode("tree 3");
        yield new Uint8Array([0]); // null terminator alone
        yield new TextEncoder().encode("abc");
      })();

      const result = await parseHeaderFromStream(stream);
      expect(result.type).toBe(ObjectType.TREE);
      expect(result.size).toBe(3);
    });

    it("should continue stream after header", async () => {
      const stream = (async function* () {
        yield new TextEncoder().encode("tag 6\0abc");
        yield new TextEncoder().encode("def");
      })();

      const result = await parseHeaderFromStream(stream);
      expect(result.type).toBe(ObjectType.TAG);
      expect(result.size).toBe(6);

      const contentChunks: Uint8Array[] = [];
      for await (const chunk of result.content) {
        contentChunks.push(chunk);
      }
      const content = concatArrays(contentChunks);
      expect(new TextDecoder().decode(content)).toBe("abcdef");
    });

    it("should throw for empty stream", async () => {
      const stream = (async function* (): AsyncIterable<Uint8Array> {
        // Empty
      })();

      await expect(parseHeaderFromStream(stream)).rejects.toThrow(
        "Invalid Git object: header not found before end of stream",
      );
    });

    it("should throw for stream without null terminator", async () => {
      const stream = (async function* () {
        yield new TextEncoder().encode("blob 13");
      })();

      await expect(parseHeaderFromStream(stream)).rejects.toThrow(
        "Invalid Git object: header not found before end of stream",
      );
    });

    it("should throw for header that exceeds size limit", async () => {
      // Create a stream with more than 1024 bytes before null
      const longData = `blob ${"x".repeat(1100)}`;
      const stream = (async function* () {
        yield new TextEncoder().encode(longData);
      })();

      await expect(parseHeaderFromStream(stream)).rejects.toThrow(
        "Invalid Git object: header too large",
      );
    });

    it("should handle all object types", async () => {
      const types: Array<[ObjectTypeCode, string]> = [
        [ObjectType.COMMIT, "commit"],
        [ObjectType.TREE, "tree"],
        [ObjectType.BLOB, "blob"],
        [ObjectType.TAG, "tag"],
      ];

      for (const [expectedType, typeStr] of types) {
        const stream = (async function* () {
          yield new TextEncoder().encode(`${typeStr} 0\0`);
        })();

        const result = await parseHeaderFromStream(stream);
        expect(result.type).toBe(expectedType);
        expect(result.size).toBe(0);
      }
    });
  });

  describe("round-trip encoding/decoding", () => {
    it("should round-trip blob header", () => {
      const originalType = ObjectType.BLOB;
      const originalSize = 12345;

      const encoded = encodeHeader(originalType, originalSize);
      const decoded = parseHeader(encoded);

      expect(decoded.type).toBe(originalType);
      expect(decoded.size).toBe(originalSize);
    });

    it("should round-trip commit header", () => {
      const originalType = ObjectType.COMMIT;
      const originalSize = 0;

      const encoded = encodeHeader(originalType, originalSize);
      const decoded = parseHeader(encoded);

      expect(decoded.type).toBe(originalType);
      expect(decoded.size).toBe(originalSize);
    });

    it("should round-trip with content", () => {
      const type = ObjectType.TREE;
      const content = new TextEncoder().encode("tree content here");

      const header = encodeHeader(type, content.length);
      const fullData = concatArrays([header, content]);

      const parsed = parseHeader(fullData);
      expect(parsed.type).toBe(type);
      expect(parsed.size).toBe(content.length);

      const extractedContent = fullData.subarray(parsed.contentOffset);
      expect(new TextDecoder().decode(extractedContent)).toBe("tree content here");
    });

    it("should round-trip all type conversions", () => {
      const types: ObjectTypeCode[] = [
        ObjectType.COMMIT,
        ObjectType.TREE,
        ObjectType.BLOB,
        ObjectType.TAG,
      ];

      for (const type of types) {
        const str = typeToString(type);
        const backToType = stringToType(str);
        expect(backToType).toBe(type);
      }
    });
  });
});
