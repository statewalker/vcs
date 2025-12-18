/**
 * Tests for Git tag format serialization/parsing
 */

import { describe, expect, it } from "vitest";
import { collect, toArray } from "../../src/format/stream-utils.js";
import {
  computeTagSize,
  decodeTagEntries,
  encodeTagEntries,
  entriesToTag,
  parseTag,
  serializeTag,
  tagToEntries,
} from "../../src/format/tag-format.js";
import type { TagEntry } from "../../src/format/types.js";
import type { AnnotatedTag } from "../../src/interfaces/tag-store.js";
import { ObjectType } from "../../src/interfaces/types.js";

describe("tag-format", () => {
  const objectId = "a".repeat(40);

  const sampleTagger = {
    name: "John Doe",
    email: "john@example.com",
    timestamp: 1234567890,
    tzOffset: "+0100",
  };

  const sampleTag: AnnotatedTag = {
    object: objectId,
    objectType: ObjectType.COMMIT,
    tag: "v1.0.0",
    tagger: sampleTagger,
    message: "Release version 1.0.0",
  };

  describe("serializeTag", () => {
    it("serializes basic tag", () => {
      const result = serializeTag(sampleTag);
      const text = new TextDecoder().decode(result);

      expect(text).toContain(`object ${objectId}`);
      expect(text).toContain("type commit");
      expect(text).toContain("tag v1.0.0");
      expect(text).toContain("tagger John Doe <john@example.com>");
      expect(text).toContain("Release version 1.0.0");
    });

    it("serializes tag without tagger", () => {
      const tag: AnnotatedTag = {
        object: objectId,
        objectType: ObjectType.COMMIT,
        tag: "v1.0.0",
        message: "Simple message",
      };

      const result = serializeTag(tag);
      const text = new TextDecoder().decode(result);

      // Should not have a "tagger " header line
      expect(text).not.toMatch(/^tagger /m);
    });

    it("serializes tag for different object types", () => {
      const types = [
        { code: ObjectType.COMMIT, str: "commit" },
        { code: ObjectType.TREE, str: "tree" },
        { code: ObjectType.BLOB, str: "blob" },
        { code: ObjectType.TAG, str: "tag" },
      ];

      for (const { code, str } of types) {
        const tag: AnnotatedTag = { ...sampleTag, objectType: code };
        const result = serializeTag(tag);
        const text = new TextDecoder().decode(result);

        expect(text).toContain(`type ${str}`);
      }
    });

    it("serializes tag with encoding", () => {
      const tag: AnnotatedTag = { ...sampleTag, encoding: "ISO-8859-1" };

      const result = serializeTag(tag);
      const text = new TextDecoder().decode(result);

      expect(text).toContain("encoding ISO-8859-1");
    });

    it("serializes tag with GPG signature", () => {
      const tag: AnnotatedTag = {
        ...sampleTag,
        gpgSignature: "-----BEGIN PGP SIGNATURE-----\nline1\n-----END PGP SIGNATURE-----",
      };

      const result = serializeTag(tag);
      const text = new TextDecoder().decode(result);

      expect(text).toContain("gpgsig -----BEGIN PGP SIGNATURE-----");
      expect(text).toContain(" line1");
    });
  });

  describe("parseTag", () => {
    it("parses basic tag", () => {
      const serialized = serializeTag(sampleTag);
      const parsed = parseTag(serialized);

      expect(parsed.object).toBe(objectId);
      expect(parsed.objectType).toBe(ObjectType.COMMIT);
      expect(parsed.tag).toBe("v1.0.0");
      expect(parsed.tagger?.name).toBe("John Doe");
      expect(parsed.message).toBe("Release version 1.0.0");
    });

    it("parses tag without tagger", () => {
      const tag: AnnotatedTag = {
        object: objectId,
        objectType: ObjectType.COMMIT,
        tag: "v1.0.0",
        message: "No tagger",
      };

      const serialized = serializeTag(tag);
      const parsed = parseTag(serialized);

      expect(parsed.tagger).toBeUndefined();
    });

    it("parses tag with encoding", () => {
      const tag: AnnotatedTag = { ...sampleTag, encoding: "ISO-8859-1" };
      const serialized = serializeTag(tag);
      const parsed = parseTag(serialized);

      expect(parsed.encoding).toBe("ISO-8859-1");
    });

    it("parses tag with GPG signature", () => {
      const tag: AnnotatedTag = { ...sampleTag, gpgSignature: "sig\nline2" };
      const serialized = serializeTag(tag);
      const parsed = parseTag(serialized);

      expect(parsed.gpgSignature).toBe("sig\nline2");
    });

    it("throws for missing object", () => {
      const data = new TextEncoder().encode("type commit\ntag v1.0.0\n\nmessage");

      expect(() => parseTag(data)).toThrow("missing object");
    });

    it("throws for missing type", () => {
      const data = new TextEncoder().encode(`object ${objectId}\ntag v1.0.0\n\nmessage`);

      expect(() => parseTag(data)).toThrow("missing type");
    });

    it("throws for missing tag name", () => {
      const data = new TextEncoder().encode(`object ${objectId}\ntype commit\n\nmessage`);

      expect(() => parseTag(data)).toThrow("missing tag");
    });
  });

  describe("tagToEntries", () => {
    it("generates entries from tag", () => {
      const entries = Array.from(tagToEntries(sampleTag));

      const types = entries.map((e) => e.type);
      expect(types).toContain("object");
      expect(types).toContain("objectType");
      expect(types).toContain("tag");
      expect(types).toContain("tagger");
      expect(types).toContain("message");
    });

    it("omits tagger entry when not present", () => {
      const tag: AnnotatedTag = {
        object: objectId,
        objectType: ObjectType.COMMIT,
        tag: "v1.0.0",
        message: "message",
      };

      const entries = Array.from(tagToEntries(tag));
      const taggerEntry = entries.find((e) => e.type === "tagger");

      expect(taggerEntry).toBeUndefined();
    });

    it("includes encoding entry when present", () => {
      const tag: AnnotatedTag = { ...sampleTag, encoding: "ISO-8859-1" };
      const entries = Array.from(tagToEntries(tag));

      const encodingEntry = entries.find((e) => e.type === "encoding");
      expect(encodingEntry).toBeDefined();
    });
  });

  describe("entriesToTag", () => {
    it("converts entries back to tag", async () => {
      const entries = Array.from(tagToEntries(sampleTag));
      const tag = await entriesToTag(entries);

      expect(tag.object).toBe(sampleTag.object);
      expect(tag.objectType).toBe(sampleTag.objectType);
      expect(tag.tag).toBe(sampleTag.tag);
      expect(tag.tagger).toEqual(sampleTag.tagger);
      expect(tag.message).toBe(sampleTag.message);
    });

    it("accepts async iterable", async () => {
      async function* gen(): AsyncIterable<TagEntry> {
        for (const entry of tagToEntries(sampleTag)) {
          yield entry;
        }
      }

      const tag = await entriesToTag(gen());
      expect(tag.object).toBe(sampleTag.object);
    });
  });

  describe("encodeTagEntries", () => {
    it("encodes entries to bytes", async () => {
      const entries = Array.from(tagToEntries(sampleTag));
      const result = await collect(encodeTagEntries(entries));
      const text = new TextDecoder().decode(result);

      expect(text).toContain(`object ${objectId}`);
      expect(text).toContain("tag v1.0.0");
    });

    it("accepts async iterable", async () => {
      async function* gen(): AsyncIterable<TagEntry> {
        for (const entry of tagToEntries(sampleTag)) {
          yield entry;
        }
      }

      const result = await collect(encodeTagEntries(gen()));
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("decodeTagEntries", () => {
    it("decodes bytes to entries", async () => {
      const serialized = serializeTag(sampleTag);

      async function* stream(): AsyncIterable<Uint8Array> {
        yield serialized;
      }

      const entries = await toArray(decodeTagEntries(stream()));

      const types = entries.map((e) => e.type);
      expect(types).toContain("object");
      expect(types).toContain("objectType");
      expect(types).toContain("tag");
      expect(types).toContain("message");
    });
  });

  describe("computeTagSize", () => {
    it("computes size from entries", async () => {
      const entries = Array.from(tagToEntries(sampleTag));
      const size = await computeTagSize(entries);
      const actual = serializeTag(sampleTag);

      expect(size).toBe(actual.length);
    });
  });

  describe("roundtrip", () => {
    it("roundtrips basic tag", () => {
      const serialized = serializeTag(sampleTag);
      const parsed = parseTag(serialized);

      expect(parsed.object).toBe(sampleTag.object);
      expect(parsed.objectType).toBe(sampleTag.objectType);
      expect(parsed.tag).toBe(sampleTag.tag);
      expect(parsed.message).toBe(sampleTag.message);
    });

    it("roundtrips tag with all fields", () => {
      const tag: AnnotatedTag = {
        ...sampleTag,
        encoding: "ISO-8859-1",
        gpgSignature: "sig\nline2\nline3",
      };

      const serialized = serializeTag(tag);
      const parsed = parseTag(serialized);

      expect(parsed.encoding).toBe(tag.encoding);
      expect(parsed.gpgSignature).toBe(tag.gpgSignature);
    });

    it("roundtrips via entry API", async () => {
      const entries = Array.from(tagToEntries(sampleTag));
      const encoded = await collect(encodeTagEntries(entries));

      async function* stream(): AsyncIterable<Uint8Array> {
        yield encoded;
      }

      const decodedEntries = await toArray(decodeTagEntries(stream()));
      const tag = await entriesToTag(decodedEntries);

      expect(tag.object).toBe(sampleTag.object);
      expect(tag.tag).toBe(sampleTag.tag);
    });

    it("handles multiline message", () => {
      const tag: AnnotatedTag = {
        ...sampleTag,
        message: "First line\n\nSecond paragraph\n\nThird paragraph",
      };

      const serialized = serializeTag(tag);
      const parsed = parseTag(serialized);

      expect(parsed.message).toBe(tag.message);
    });
  });
});
