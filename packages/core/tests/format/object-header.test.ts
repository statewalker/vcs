/**
 * Tests for Git object header encoding/decoding
 */

import { collect } from "@webrun-vcs/utils/streams";
import { describe, expect, it } from "vitest";
import {
  createGitObject,
  encodeHeader,
  encodeObjectHeader,
  extractGitObjectContent,
  parseHeader,
  stripHeader,
  typeCodeToString,
  typeStringToCode,
} from "../../src/format/object-header.js";
import { ObjectType } from "../../src/types/index.js";

describe("object-header", () => {
  describe("typeCodeToString", () => {
    it("converts COMMIT to commit", () => {
      expect(typeCodeToString(ObjectType.COMMIT)).toBe("commit");
    });

    it("converts TREE to tree", () => {
      expect(typeCodeToString(ObjectType.TREE)).toBe("tree");
    });

    it("converts BLOB to blob", () => {
      expect(typeCodeToString(ObjectType.BLOB)).toBe("blob");
    });

    it("converts TAG to tag", () => {
      expect(typeCodeToString(ObjectType.TAG)).toBe("tag");
    });

    it("throws for unknown type code", () => {
      expect(() => typeCodeToString(99 as never)).toThrow("Unknown object type code");
    });
  });

  describe("typeStringToCode", () => {
    it("converts commit to COMMIT", () => {
      expect(typeStringToCode("commit")).toBe(ObjectType.COMMIT);
    });

    it("converts tree to TREE", () => {
      expect(typeStringToCode("tree")).toBe(ObjectType.TREE);
    });

    it("converts blob to BLOB", () => {
      expect(typeStringToCode("blob")).toBe(ObjectType.BLOB);
    });

    it("converts tag to TAG", () => {
      expect(typeStringToCode("tag")).toBe(ObjectType.TAG);
    });

    it("throws for unknown type string", () => {
      expect(() => typeStringToCode("invalid" as never)).toThrow("Unknown object type");
    });
  });

  describe("encodeHeader", () => {
    it("encodes blob header", () => {
      const chunks = Array.from(encodeHeader("blob", 100));
      expect(chunks).toHaveLength(1);
      const decoded = new TextDecoder().decode(chunks[0]);
      expect(decoded).toBe("blob 100\0");
    });

    it("encodes commit header", () => {
      const chunks = Array.from(encodeHeader("commit", 250));
      const decoded = new TextDecoder().decode(chunks[0]);
      expect(decoded).toBe("commit 250\0");
    });

    it("encodes tree header with zero size", () => {
      const chunks = Array.from(encodeHeader("tree", 0));
      const decoded = new TextDecoder().decode(chunks[0]);
      expect(decoded).toBe("tree 0\0");
    });
  });

  describe("encodeObjectHeader", () => {
    it("encodes header as single Uint8Array", () => {
      const result = encodeObjectHeader("blob", 42);
      const decoded = new TextDecoder().decode(result);
      expect(decoded).toBe("blob 42\0");
    });
  });

  describe("parseHeader", () => {
    it("parses blob header", () => {
      const data = new TextEncoder().encode("blob 100\0content here");
      const result = parseHeader(data);

      expect(result.type).toBe("blob");
      expect(result.typeCode).toBe(ObjectType.BLOB);
      expect(result.size).toBe(100);
      expect(result.contentOffset).toBe(9);
    });

    it("parses commit header", () => {
      const data = new TextEncoder().encode("commit 1234\0");
      const result = parseHeader(data);

      expect(result.type).toBe("commit");
      expect(result.size).toBe(1234);
    });

    it("parses tree header", () => {
      const data = new TextEncoder().encode("tree 0\0");
      const result = parseHeader(data);

      expect(result.type).toBe("tree");
      expect(result.size).toBe(0);
      expect(result.contentOffset).toBe(7);
    });

    it("parses tag header", () => {
      const data = new TextEncoder().encode("tag 500\0");
      const result = parseHeader(data);

      expect(result.type).toBe("tag");
      expect(result.size).toBe(500);
    });

    it("throws for missing null byte", () => {
      const data = new TextEncoder().encode("blob 100 no null");
      expect(() => parseHeader(data)).toThrow("no null byte");
    });

    it("throws for missing space", () => {
      const data = new TextEncoder().encode("blob100\0");
      expect(() => parseHeader(data)).toThrow("no space");
    });

    it("throws for invalid type", () => {
      const data = new TextEncoder().encode("invalid 100\0");
      expect(() => parseHeader(data)).toThrow("Invalid object type");
    });

    it("throws for invalid size", () => {
      const data = new TextEncoder().encode("blob abc\0");
      expect(() => parseHeader(data)).toThrow("Invalid object size");
    });
  });

  describe("stripHeader", () => {
    it("strips header from stream", async () => {
      const data = new TextEncoder().encode("blob 5\0hello");

      async function* stream(): AsyncIterable<Uint8Array> {
        yield data;
      }

      const content = await collect(stripHeader(stream()));
      expect(new TextDecoder().decode(content)).toBe("hello");
    });

    it("handles chunked input", async () => {
      const header = new TextEncoder().encode("blob 5\0");
      const content = new TextEncoder().encode("hello");

      async function* stream(): AsyncIterable<Uint8Array> {
        yield header;
        yield content;
      }

      const result = await collect(stripHeader(stream()));
      expect(new TextDecoder().decode(result)).toBe("hello");
    });

    it("handles header split across chunks", async () => {
      const part1 = new TextEncoder().encode("blo");
      const part2 = new TextEncoder().encode("b 5\0hel");
      const part3 = new TextEncoder().encode("lo");

      async function* stream(): AsyncIterable<Uint8Array> {
        yield part1;
        yield part2;
        yield part3;
      }

      const result = await collect(stripHeader(stream()));
      expect(new TextDecoder().decode(result)).toBe("hello");
    });

    it("throws for empty stream", async () => {
      async function* stream(): AsyncIterable<Uint8Array> {}

      await expect(collect(stripHeader(stream()))).rejects.toThrow("empty or truncated");
    });
  });

  describe("createGitObject", () => {
    it("creates full object with header", () => {
      const content = new TextEncoder().encode("hello");
      const object = createGitObject("blob", content);

      const decoded = new TextDecoder().decode(object);
      expect(decoded).toBe("blob 5\0hello");
    });
  });

  describe("extractGitObjectContent", () => {
    it("extracts content without header", () => {
      const object = new TextEncoder().encode("blob 5\0hello");
      const content = extractGitObjectContent(object);

      expect(new TextDecoder().decode(content)).toBe("hello");
    });
  });

  describe("roundtrip", () => {
    it("roundtrips all object types", () => {
      const types = ["blob", "commit", "tree", "tag"] as const;
      const content = new TextEncoder().encode("test content");

      for (const type of types) {
        const object = createGitObject(type, content);
        const header = parseHeader(object);
        const extracted = extractGitObjectContent(object);

        expect(header.type).toBe(type);
        expect(header.size).toBe(content.length);
        expect(extracted).toEqual(content);
      }
    });
  });
});
