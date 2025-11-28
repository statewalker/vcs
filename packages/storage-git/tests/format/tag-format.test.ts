/**
 * Tests for Git tag format serialization/parsing
 */

import { describe, expect, it } from "vitest";
import type { AnnotatedTag, PersonIdent } from "@webrun-vcs/storage";
import { ObjectType } from "@webrun-vcs/storage";
import { parseTag, serializeTag } from "../../src/format/tag-format.js";

describe("tag-format", () => {
  const sampleTagger: PersonIdent = {
    name: "John Doe",
    email: "john@example.com",
    timestamp: 1234567890,
    tzOffset: "+0100",
  };

  const sampleObjectId = "a".repeat(40);

  describe("serializeTag", () => {
    it("serializes basic tag", () => {
      const tag: AnnotatedTag = {
        object: sampleObjectId,
        objectType: ObjectType.COMMIT,
        tag: "v1.0.0",
        tagger: sampleTagger,
        message: "Release version 1.0.0",
      };

      const result = serializeTag(tag);
      const text = new TextDecoder().decode(result);

      expect(text).toContain(`object ${sampleObjectId}`);
      expect(text).toContain("type commit");
      expect(text).toContain("tag v1.0.0");
      expect(text).toContain("tagger John Doe <john@example.com>");
      expect(text).toContain("Release version 1.0.0");
    });

    it("serializes tag without tagger", () => {
      const tag: AnnotatedTag = {
        object: sampleObjectId,
        objectType: ObjectType.COMMIT,
        tag: "v1.0.0",
        message: "Release version 1.0.0",
      };

      const result = serializeTag(tag);
      const text = new TextDecoder().decode(result);

      expect(text).not.toContain("tagger");
    });

    it("serializes tag pointing to tree", () => {
      const tag: AnnotatedTag = {
        object: sampleObjectId,
        objectType: ObjectType.TREE,
        tag: "tree-tag",
        message: "Tag pointing to tree",
      };

      const result = serializeTag(tag);
      const text = new TextDecoder().decode(result);

      expect(text).toContain("type tree");
    });

    it("serializes tag pointing to blob", () => {
      const tag: AnnotatedTag = {
        object: sampleObjectId,
        objectType: ObjectType.BLOB,
        tag: "blob-tag",
        message: "Tag pointing to blob",
      };

      const result = serializeTag(tag);
      const text = new TextDecoder().decode(result);

      expect(text).toContain("type blob");
    });

    it("serializes tag pointing to another tag", () => {
      const tag: AnnotatedTag = {
        object: sampleObjectId,
        objectType: ObjectType.TAG,
        tag: "nested-tag",
        message: "Tag pointing to tag",
      };

      const result = serializeTag(tag);
      const text = new TextDecoder().decode(result);

      expect(text).toContain("type tag");
    });

    it("serializes multi-line message", () => {
      const tag: AnnotatedTag = {
        object: sampleObjectId,
        objectType: ObjectType.COMMIT,
        tag: "v1.0.0",
        tagger: sampleTagger,
        message: "First line\n\nDetailed changelog\n- Feature 1\n- Feature 2",
      };

      const result = serializeTag(tag);
      const text = new TextDecoder().decode(result);

      expect(text).toContain("First line\n\nDetailed changelog");
    });

    it("serializes tag with encoding", () => {
      const tag: AnnotatedTag = {
        object: sampleObjectId,
        objectType: ObjectType.COMMIT,
        tag: "v1.0.0",
        message: "Message",
        encoding: "ISO-8859-1",
      };

      const result = serializeTag(tag);
      const text = new TextDecoder().decode(result);

      expect(text).toContain("encoding ISO-8859-1");
    });
  });

  describe("parseTag", () => {
    it("parses basic tag", () => {
      const text = `object ${sampleObjectId}
type commit
tag v1.0.0
tagger John Doe <john@example.com> 1234567890 +0100

Release version 1.0.0`;

      const tag = parseTag(new TextEncoder().encode(text));

      expect(tag.object).toBe(sampleObjectId);
      expect(tag.objectType).toBe(ObjectType.COMMIT);
      expect(tag.tag).toBe("v1.0.0");
      expect(tag.tagger?.name).toBe("John Doe");
      expect(tag.tagger?.email).toBe("john@example.com");
      expect(tag.tagger?.timestamp).toBe(1234567890);
      expect(tag.message).toBe("Release version 1.0.0");
    });

    it("parses tag without tagger", () => {
      const text = `object ${sampleObjectId}
type commit
tag v1.0.0

Release message`;

      const tag = parseTag(new TextEncoder().encode(text));

      expect(tag.tagger).toBeUndefined();
    });

    it("parses tag pointing to tree", () => {
      const text = `object ${sampleObjectId}
type tree
tag tree-tag

Tag message`;

      const tag = parseTag(new TextEncoder().encode(text));

      expect(tag.objectType).toBe(ObjectType.TREE);
    });

    it("parses multi-line message", () => {
      const text = `object ${sampleObjectId}
type commit
tag v1.0.0

First line

Changelog:
- Feature 1
- Feature 2`;

      const tag = parseTag(new TextEncoder().encode(text));

      expect(tag.message).toBe("First line\n\nChangelog:\n- Feature 1\n- Feature 2");
    });

    it("parses tag with encoding", () => {
      const text = `object ${sampleObjectId}
type commit
tag v1.0.0
encoding ISO-8859-1

Message`;

      const tag = parseTag(new TextEncoder().encode(text));

      expect(tag.encoding).toBe("ISO-8859-1");
    });

    it("throws for missing object", () => {
      const text = `type commit
tag v1.0.0

Message`;

      expect(() => parseTag(new TextEncoder().encode(text))).toThrow("missing object");
    });

    it("throws for missing type", () => {
      const text = `object ${sampleObjectId}
tag v1.0.0

Message`;

      expect(() => parseTag(new TextEncoder().encode(text))).toThrow("missing type");
    });

    it("throws for missing tag name", () => {
      const text = `object ${sampleObjectId}
type commit

Message`;

      expect(() => parseTag(new TextEncoder().encode(text))).toThrow("missing tag name");
    });
  });

  describe("roundtrip", () => {
    it("preserves all fields", () => {
      const original: AnnotatedTag = {
        object: sampleObjectId,
        objectType: ObjectType.COMMIT,
        tag: "v1.0.0",
        tagger: sampleTagger,
        message: "Test tag\n\nWith details",
        encoding: "ISO-8859-1",
      };

      const serialized = serializeTag(original);
      const parsed = parseTag(serialized);

      expect(parsed.object).toBe(original.object);
      expect(parsed.objectType).toBe(original.objectType);
      expect(parsed.tag).toBe(original.tag);
      expect(parsed.tagger).toEqual(original.tagger);
      expect(parsed.message).toBe(original.message);
      expect(parsed.encoding).toBe(original.encoding);
    });

    it("preserves tag without optional fields", () => {
      const original: AnnotatedTag = {
        object: sampleObjectId,
        objectType: ObjectType.COMMIT,
        tag: "minimal-tag",
        message: "",
      };

      const serialized = serializeTag(original);
      const parsed = parseTag(serialized);

      expect(parsed.object).toBe(original.object);
      expect(parsed.tag).toBe(original.tag);
      expect(parsed.tagger).toBeUndefined();
      expect(parsed.message).toBe("");
    });

    it("handles all object types", () => {
      for (const objectType of [ObjectType.COMMIT, ObjectType.TREE, ObjectType.BLOB, ObjectType.TAG]) {
        const original: AnnotatedTag = {
          object: sampleObjectId,
          objectType,
          tag: `tag-for-type-${objectType}`,
          message: "Message",
        };

        const serialized = serializeTag(original);
        const parsed = parseTag(serialized);

        expect(parsed.objectType).toBe(objectType);
      }
    });
  });
});
