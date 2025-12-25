/**
 * Tests for reference types and parsing
 *
 * Based on JGit RefTest and storage-git ref tests
 */

import { describe, expect, it } from "vitest";
import { parsePackedRefs } from "../../src/refs/packed-refs-reader.js";
import {
  createPeeledRef,
  createPeeledTagRef,
  createRef,
  createSymbolicRef,
  FETCH_HEAD,
  HEAD,
  isSymbolicRef,
  MERGE_HEAD,
  ORIG_HEAD,
  R_HEADS,
  R_REFS,
  R_REMOTES,
  R_TAGS,
  RefStore,
  SYMREF_PREFIX,
} from "../../src/refs/ref-types.js";

describe("ref-types", () => {
  describe("createRef", () => {
    it("creates a basic ref", () => {
      const ref = createRef("refs/heads/main", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

      expect(ref.name).toBe("refs/heads/main");
      expect(ref.objectId).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(ref.storage).toBe(RefStore.LOOSE);
      expect(ref.peeled).toBe(false);
    });

    it("creates ref with custom storage", () => {
      const ref = createRef(
        "refs/heads/main",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        RefStore.PACKED,
      );

      expect(ref.storage).toBe(RefStore.PACKED);
    });

    it("creates ref with undefined objectId (unborn)", () => {
      const ref = createRef("refs/heads/main", undefined);

      expect(ref.objectId).toBeUndefined();
    });
  });

  describe("createPeeledRef", () => {
    it("creates a peeled non-tag ref", () => {
      const ref = createPeeledRef("refs/heads/main", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

      expect(ref.name).toBe("refs/heads/main");
      expect(ref.objectId).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(ref.peeled).toBe(true);
      expect(ref.peeledObjectId).toBeUndefined();
    });
  });

  describe("createPeeledTagRef", () => {
    it("creates a peeled tag ref with target", () => {
      const ref = createPeeledTagRef(
        "refs/tags/v1.0",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", // tag object
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", // target commit
      );

      expect(ref.name).toBe("refs/tags/v1.0");
      expect(ref.objectId).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(ref.peeled).toBe(true);
      expect(ref.peeledObjectId).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    });
  });

  describe("createSymbolicRef", () => {
    it("creates a symbolic ref", () => {
      const ref = createSymbolicRef("HEAD", "refs/heads/main");

      expect(ref.name).toBe("HEAD");
      expect(ref.target).toBe("refs/heads/main");
      expect(ref.storage).toBe(RefStore.LOOSE);
    });
  });

  describe("isSymbolicRef", () => {
    it("returns true for symbolic refs", () => {
      const ref = createSymbolicRef("HEAD", "refs/heads/main");
      expect(isSymbolicRef(ref)).toBe(true);
    });

    it("returns false for regular refs", () => {
      const ref = createRef("refs/heads/main", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(isSymbolicRef(ref)).toBe(false);
    });
  });

  describe("constants", () => {
    it("defines ref prefixes", () => {
      expect(R_REFS).toBe("refs/");
      expect(R_HEADS).toBe("refs/heads/");
      expect(R_TAGS).toBe("refs/tags/");
      expect(R_REMOTES).toBe("refs/remotes/");
    });

    it("defines special refs", () => {
      expect(HEAD).toBe("HEAD");
      expect(FETCH_HEAD).toBe("FETCH_HEAD");
      expect(ORIG_HEAD).toBe("ORIG_HEAD");
      expect(MERGE_HEAD).toBe("MERGE_HEAD");
    });

    it("defines symref prefix", () => {
      expect(SYMREF_PREFIX).toBe("ref: ");
    });
  });

  describe("RefStore enum", () => {
    it("has expected values", () => {
      expect(RefStore.NEW).toBe("new");
      expect(RefStore.LOOSE).toBe("loose");
      expect(RefStore.PACKED).toBe("packed");
      expect(RefStore.LOOSE_PACKED).toBe("loose_packed");
    });
  });
});

describe("parsePackedRefs", () => {
  it("parses empty content", () => {
    const result = parsePackedRefs("");

    expect(result.refs).toEqual([]);
    expect(result.peeled).toBe(false);
  });

  it("parses simple refs", () => {
    const content = `# pack-refs with:
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb refs/heads/feature
`;

    const result = parsePackedRefs(content);

    expect(result.refs.length).toBe(2);
    expect(result.refs[0].name).toBe("refs/heads/main");
    expect(result.refs[0].objectId).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(result.refs[1].name).toBe("refs/heads/feature");
    expect(result.refs[1].objectId).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("parses refs with peeled header", () => {
    const content = `# pack-refs with: peeled
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main
`;

    const result = parsePackedRefs(content);

    expect(result.peeled).toBe(true);
    expect(result.refs[0].peeled).toBe(true);
  });

  it("parses peeled tags", () => {
    const content = `# pack-refs with: peeled
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/tags/v1.0
^bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
`;

    const result = parsePackedRefs(content);

    expect(result.refs.length).toBe(1);
    const tag = result.refs[0];
    expect(tag.name).toBe("refs/tags/v1.0");
    expect(tag.objectId).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(tag.peeledObjectId).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(tag.peeled).toBe(true);
  });

  it("handles mixed refs and tags", () => {
    const content = `# pack-refs with: peeled
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb refs/tags/v1.0
^cccccccccccccccccccccccccccccccccccccccc
dddddddddddddddddddddddddddddddddddddddd refs/heads/feature
`;

    const result = parsePackedRefs(content);

    expect(result.refs.length).toBe(3);

    // Non-tag ref
    expect(result.refs[0].name).toBe("refs/heads/main");
    expect(result.refs[0].peeledObjectId).toBeUndefined();

    // Peeled tag
    expect(result.refs[1].name).toBe("refs/tags/v1.0");
    expect(result.refs[1].peeledObjectId).toBe("cccccccccccccccccccccccccccccccccccccccc");

    // Another non-tag ref
    expect(result.refs[2].name).toBe("refs/heads/feature");
    expect(result.refs[2].peeledObjectId).toBeUndefined();
  });

  it("handles Windows line endings", () => {
    const content = `# pack-refs with:\r\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main\r\n`;

    const result = parsePackedRefs(content);

    expect(result.refs.length).toBe(1);
    expect(result.refs[0].name).toBe("refs/heads/main");
  });

  it("handles old Mac line endings", () => {
    const content = `# pack-refs with:\raaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main\r`;

    const result = parsePackedRefs(content);

    expect(result.refs.length).toBe(1);
    expect(result.refs[0].name).toBe("refs/heads/main");
  });

  it("ignores blank lines", () => {
    const content = `# pack-refs with:

aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main

bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb refs/heads/feature

`;

    const result = parsePackedRefs(content);

    expect(result.refs.length).toBe(2);
  });

  it("ignores comment lines", () => {
    const content = `# pack-refs with:
# This is a comment
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main
# Another comment
`;

    const result = parsePackedRefs(content);

    expect(result.refs.length).toBe(1);
    expect(result.refs[0].name).toBe("refs/heads/main");
  });

  it("normalizes object IDs to lowercase", () => {
    const content = `# pack-refs with:
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA refs/heads/main
`;

    const result = parsePackedRefs(content);

    expect(result.refs[0].objectId).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("throws on invalid line format", () => {
    const content = `# pack-refs with:
invalidline
`;

    expect(() => parsePackedRefs(content)).toThrow("Invalid packed-refs line");
  });

  it("throws on invalid object ID length", () => {
    const content = `# pack-refs with:
shortid refs/heads/main
`;

    expect(() => parsePackedRefs(content)).toThrow("Invalid object ID");
  });

  it("throws on peeled line before ref", () => {
    const content = `# pack-refs with: peeled
^aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`;

    expect(() => parsePackedRefs(content)).toThrow("Peeled line before ref");
  });

  it("parses refs without header", () => {
    const content = `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb refs/heads/feature
`;

    const result = parsePackedRefs(content);

    expect(result.refs.length).toBe(2);
    expect(result.peeled).toBe(false);
    // Without peeled header, refs are not marked as peeled
    expect(result.refs[0].peeled).toBe(false);
  });
});
