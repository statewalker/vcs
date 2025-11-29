/**
 * Tests for Git object header encoding/parsing
 */

import { ObjectType } from "@webrun-vcs/storage";
import { describe, expect, it } from "vitest";
import {
  createGitObject,
  encodeObjectHeader,
  encodeObjectHeaderFromCode,
  extractGitObjectContent,
  parseObjectHeader,
  typeCodeToString,
  typeStringToCode,
} from "../../src/format/object-header.js";

describe("object-header", () => {
  describe("type conversion", () => {
    it("converts type codes to strings", () => {
      expect(typeCodeToString(ObjectType.COMMIT)).toBe("commit");
      expect(typeCodeToString(ObjectType.TREE)).toBe("tree");
      expect(typeCodeToString(ObjectType.BLOB)).toBe("blob");
      expect(typeCodeToString(ObjectType.TAG)).toBe("tag");
    });

    it("converts type strings to codes", () => {
      expect(typeStringToCode("commit")).toBe(ObjectType.COMMIT);
      expect(typeStringToCode("tree")).toBe(ObjectType.TREE);
      expect(typeStringToCode("blob")).toBe(ObjectType.BLOB);
      expect(typeStringToCode("tag")).toBe(ObjectType.TAG);
    });

    it("throws for unknown type codes", () => {
      expect(() => typeCodeToString(99 as never)).toThrow("Unknown object type code");
    });

    it("throws for unknown type strings", () => {
      expect(() => typeStringToCode("unknown" as never)).toThrow("Unknown object type");
    });
  });

  describe("encodeObjectHeader", () => {
    it("encodes blob header", () => {
      const header = encodeObjectHeader("blob", 42);
      expect(new TextDecoder().decode(header)).toBe("blob 42\0");
    });

    it("encodes tree header", () => {
      const header = encodeObjectHeader("tree", 100);
      expect(new TextDecoder().decode(header)).toBe("tree 100\0");
    });

    it("encodes commit header", () => {
      const header = encodeObjectHeader("commit", 256);
      expect(new TextDecoder().decode(header)).toBe("commit 256\0");
    });

    it("encodes zero-length object", () => {
      const header = encodeObjectHeader("blob", 0);
      expect(new TextDecoder().decode(header)).toBe("blob 0\0");
    });

    it("encodes from type code", () => {
      const header = encodeObjectHeaderFromCode(ObjectType.BLOB, 42);
      expect(new TextDecoder().decode(header)).toBe("blob 42\0");
    });
  });

  describe("parseObjectHeader", () => {
    it("parses blob header", () => {
      const data = new TextEncoder().encode("blob 42\0hello");
      const header = parseObjectHeader(data);

      expect(header.type).toBe("blob");
      expect(header.typeCode).toBe(ObjectType.BLOB);
      expect(header.size).toBe(42);
      expect(header.contentOffset).toBe(8);
    });

    it("parses tree header", () => {
      const data = new TextEncoder().encode("tree 100\0...");
      const header = parseObjectHeader(data);

      expect(header.type).toBe("tree");
      expect(header.typeCode).toBe(ObjectType.TREE);
      expect(header.size).toBe(100);
    });

    it("parses large size", () => {
      const data = new TextEncoder().encode("blob 1234567890\0...");
      const header = parseObjectHeader(data);

      expect(header.size).toBe(1234567890);
    });

    it("throws for missing null byte", () => {
      const data = new TextEncoder().encode("blob 42 no null");
      expect(() => parseObjectHeader(data)).toThrow("no null byte");
    });

    it("throws for missing space", () => {
      const data = new TextEncoder().encode("blob42\0");
      expect(() => parseObjectHeader(data)).toThrow("no space");
    });

    it("throws for invalid type", () => {
      const data = new TextEncoder().encode("unknown 42\0");
      expect(() => parseObjectHeader(data)).toThrow("Invalid object type");
    });

    it("throws for invalid size", () => {
      const data = new TextEncoder().encode("blob abc\0");
      expect(() => parseObjectHeader(data)).toThrow("Invalid object size");
    });
  });

  describe("createGitObject", () => {
    it("creates full object with header", () => {
      const content = new TextEncoder().encode("hello");
      const object = createGitObject("blob", content);

      expect(new TextDecoder().decode(object)).toBe("blob 5\0hello");
    });

    it("creates empty object", () => {
      const content = new Uint8Array(0);
      const object = createGitObject("tree", content);

      expect(new TextDecoder().decode(object)).toBe("tree 0\0");
    });
  });

  describe("extractGitObjectContent", () => {
    it("extracts content from object", () => {
      const object = new TextEncoder().encode("blob 5\0hello");
      const content = extractGitObjectContent(object);

      expect(new TextDecoder().decode(content)).toBe("hello");
    });

    it("handles empty content", () => {
      const object = new TextEncoder().encode("tree 0\0");
      const content = extractGitObjectContent(object);

      expect(content.length).toBe(0);
    });
  });

  describe("roundtrip", () => {
    it("encodes and parses correctly", () => {
      for (const type of ["blob", "tree", "commit", "tag"] as const) {
        for (const size of [0, 1, 42, 1000, 1000000]) {
          const header = encodeObjectHeader(type, size);
          const parsed = parseObjectHeader(header);

          expect(parsed.type).toBe(type);
          expect(parsed.size).toBe(size);
        }
      }
    });
  });
});
