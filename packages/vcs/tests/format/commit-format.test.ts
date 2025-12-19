/**
 * Tests for Git commit format serialization/parsing
 */

import { describe, expect, it } from "vitest";
import {
  commitToEntries,
  computeCommitSize,
  decodeCommitEntries,
  encodeCommitEntries,
  entriesToCommit,
  parseCommit,
  serializeCommit,
} from "../../src/format/commit-format.js";
import { collect, toArray } from "../../src/format/stream-utils.js";
import type { CommitEntry } from "../../src/format/types.js";
import type { Commit } from "../../src/object-storage/interfaces/index.js";

describe("commit-format", () => {
  const treeId = "a".repeat(40);
  const parentId = "b".repeat(40);
  const anotherParentId = "c".repeat(40);

  const sampleAuthor = {
    name: "John Doe",
    email: "john@example.com",
    timestamp: 1234567890,
    tzOffset: "+0100",
  };

  const sampleCommitter = {
    name: "Jane Smith",
    email: "jane@example.com",
    timestamp: 1234567900,
    tzOffset: "-0500",
  };

  const sampleCommit: Commit = {
    tree: treeId,
    parents: [parentId],
    author: sampleAuthor,
    committer: sampleCommitter,
    message: "Test commit message",
  };

  describe("serializeCommit", () => {
    it("serializes basic commit", () => {
      const result = serializeCommit(sampleCommit);
      const text = new TextDecoder().decode(result);

      expect(text).toContain(`tree ${treeId}`);
      expect(text).toContain(`parent ${parentId}`);
      expect(text).toContain("author John Doe <john@example.com>");
      expect(text).toContain("committer Jane Smith <jane@example.com>");
      expect(text).toContain("Test commit message");
    });

    it("serializes commit without parents", () => {
      const commit: Commit = {
        ...sampleCommit,
        parents: [],
      };

      const result = serializeCommit(commit);
      const text = new TextDecoder().decode(result);

      expect(text).not.toContain("parent");
    });

    it("serializes commit with multiple parents", () => {
      const commit: Commit = {
        ...sampleCommit,
        parents: [parentId, anotherParentId],
      };

      const result = serializeCommit(commit);
      const text = new TextDecoder().decode(result);

      expect(text).toContain(`parent ${parentId}`);
      expect(text).toContain(`parent ${anotherParentId}`);
    });

    it("serializes commit with encoding", () => {
      const commit: Commit = {
        ...sampleCommit,
        encoding: "ISO-8859-1",
      };

      const result = serializeCommit(commit);
      const text = new TextDecoder().decode(result);

      expect(text).toContain("encoding ISO-8859-1");
    });

    it("does not include UTF-8 encoding header", () => {
      const commit: Commit = {
        ...sampleCommit,
        encoding: "UTF-8",
      };

      const result = serializeCommit(commit);
      const text = new TextDecoder().decode(result);

      expect(text).not.toContain("encoding");
    });

    it("serializes commit with GPG signature", () => {
      const commit: Commit = {
        ...sampleCommit,
        gpgSignature: "-----BEGIN PGP SIGNATURE-----\nline1\nline2\n-----END PGP SIGNATURE-----",
      };

      const result = serializeCommit(commit);
      const text = new TextDecoder().decode(result);

      expect(text).toContain("gpgsig -----BEGIN PGP SIGNATURE-----");
      expect(text).toContain(" line1");
      expect(text).toContain(" line2");
    });
  });

  describe("parseCommit", () => {
    it("parses basic commit", () => {
      const serialized = serializeCommit(sampleCommit);
      const parsed = parseCommit(serialized);

      expect(parsed.tree).toBe(treeId);
      expect(parsed.parents).toEqual([parentId]);
      expect(parsed.author.name).toBe("John Doe");
      expect(parsed.committer.name).toBe("Jane Smith");
      expect(parsed.message).toBe("Test commit message");
    });

    it("parses commit without parents", () => {
      const commit: Commit = { ...sampleCommit, parents: [] };
      const serialized = serializeCommit(commit);
      const parsed = parseCommit(serialized);

      expect(parsed.parents).toEqual([]);
    });

    it("parses commit with multiple parents", () => {
      const commit: Commit = {
        ...sampleCommit,
        parents: [parentId, anotherParentId],
      };
      const serialized = serializeCommit(commit);
      const parsed = parseCommit(serialized);

      expect(parsed.parents).toEqual([parentId, anotherParentId]);
    });

    it("parses commit with encoding", () => {
      const commit: Commit = { ...sampleCommit, encoding: "ISO-8859-1" };
      const serialized = serializeCommit(commit);
      const parsed = parseCommit(serialized);

      expect(parsed.encoding).toBe("ISO-8859-1");
    });

    it("parses commit with GPG signature", () => {
      const commit: Commit = {
        ...sampleCommit,
        gpgSignature: "sig\nline2",
      };
      const serialized = serializeCommit(commit);
      const parsed = parseCommit(serialized);

      expect(parsed.gpgSignature).toBe("sig\nline2");
    });

    it("throws for missing tree", () => {
      const data = new TextEncoder().encode(
        "parent abc\nauthor Test <test@test.com> 123 +0000\ncommitter Test <test@test.com> 123 +0000\n\nmessage",
      );

      expect(() => parseCommit(data)).toThrow("missing tree");
    });

    it("throws for missing author", () => {
      const data = new TextEncoder().encode(
        `tree ${treeId}\ncommitter Test <test@test.com> 123 +0000\n\nmessage`,
      );

      expect(() => parseCommit(data)).toThrow("missing author");
    });

    it("throws for missing committer", () => {
      const data = new TextEncoder().encode(
        `tree ${treeId}\nauthor Test <test@test.com> 123 +0000\n\nmessage`,
      );

      expect(() => parseCommit(data)).toThrow("missing committer");
    });
  });

  describe("commitToEntries", () => {
    it("generates entries from commit", () => {
      const entries = Array.from(commitToEntries(sampleCommit));

      const types = entries.map((e) => e.type);
      expect(types).toContain("tree");
      expect(types).toContain("parent");
      expect(types).toContain("author");
      expect(types).toContain("committer");
      expect(types).toContain("message");
    });

    it("generates parent entries for each parent", () => {
      const commit: Commit = {
        ...sampleCommit,
        parents: [parentId, anotherParentId],
      };

      const entries = Array.from(commitToEntries(commit));
      const parentEntries = entries.filter((e) => e.type === "parent");

      expect(parentEntries).toHaveLength(2);
    });

    it("includes encoding entry when present", () => {
      const commit: Commit = { ...sampleCommit, encoding: "ISO-8859-1" };
      const entries = Array.from(commitToEntries(commit));

      const encodingEntry = entries.find((e) => e.type === "encoding");
      expect(encodingEntry).toBeDefined();
    });

    it("includes gpgsig entry when present", () => {
      const commit: Commit = { ...sampleCommit, gpgSignature: "signature" };
      const entries = Array.from(commitToEntries(commit));

      const gpgEntry = entries.find((e) => e.type === "gpgsig");
      expect(gpgEntry).toBeDefined();
    });
  });

  describe("entriesToCommit", () => {
    it("converts entries back to commit", async () => {
      const entries = Array.from(commitToEntries(sampleCommit));
      const commit = await entriesToCommit(entries);

      expect(commit.tree).toBe(sampleCommit.tree);
      expect(commit.parents).toEqual(sampleCommit.parents);
      expect(commit.author).toEqual(sampleCommit.author);
      expect(commit.committer).toEqual(sampleCommit.committer);
      expect(commit.message).toBe(sampleCommit.message);
    });

    it("accepts async iterable", async () => {
      async function* gen(): AsyncIterable<CommitEntry> {
        for (const entry of commitToEntries(sampleCommit)) {
          yield entry;
        }
      }

      const commit = await entriesToCommit(gen());
      expect(commit.tree).toBe(sampleCommit.tree);
    });
  });

  describe("encodeCommitEntries", () => {
    it("encodes entries to bytes", async () => {
      const entries = Array.from(commitToEntries(sampleCommit));
      const result = await collect(encodeCommitEntries(entries));
      const text = new TextDecoder().decode(result);

      expect(text).toContain(`tree ${treeId}`);
      expect(text).toContain("Test commit message");
    });

    it("accepts async iterable", async () => {
      async function* gen(): AsyncIterable<CommitEntry> {
        for (const entry of commitToEntries(sampleCommit)) {
          yield entry;
        }
      }

      const result = await collect(encodeCommitEntries(gen()));
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("decodeCommitEntries", () => {
    it("decodes bytes to entries", async () => {
      const serialized = serializeCommit(sampleCommit);

      async function* stream(): AsyncIterable<Uint8Array> {
        yield serialized;
      }

      const entries = await toArray(decodeCommitEntries(stream()));

      const types = entries.map((e) => e.type);
      expect(types).toContain("tree");
      expect(types).toContain("author");
      expect(types).toContain("committer");
      expect(types).toContain("message");
    });
  });

  describe("computeCommitSize", () => {
    it("computes size from entries", async () => {
      const entries = Array.from(commitToEntries(sampleCommit));
      const size = await computeCommitSize(entries);
      const actual = serializeCommit(sampleCommit);

      expect(size).toBe(actual.length);
    });
  });

  describe("roundtrip", () => {
    it("roundtrips basic commit", () => {
      const serialized = serializeCommit(sampleCommit);
      const parsed = parseCommit(serialized);

      expect(parsed.tree).toBe(sampleCommit.tree);
      expect(parsed.parents).toEqual(sampleCommit.parents);
      expect(parsed.message).toBe(sampleCommit.message);
    });

    it("roundtrips commit with all fields", () => {
      const commit: Commit = {
        ...sampleCommit,
        parents: [parentId, anotherParentId],
        encoding: "ISO-8859-1",
        gpgSignature: "sig\nline2\nline3",
      };

      const serialized = serializeCommit(commit);
      const parsed = parseCommit(serialized);

      expect(parsed.encoding).toBe(commit.encoding);
      expect(parsed.gpgSignature).toBe(commit.gpgSignature);
    });

    it("roundtrips via entry API", async () => {
      const entries = Array.from(commitToEntries(sampleCommit));
      const encoded = await collect(encodeCommitEntries(entries));

      async function* stream(): AsyncIterable<Uint8Array> {
        yield encoded;
      }

      const decodedEntries = await toArray(decodeCommitEntries(stream()));
      const commit = await entriesToCommit(decodedEntries);

      expect(commit.tree).toBe(sampleCommit.tree);
      expect(commit.message).toBe(sampleCommit.message);
    });

    it("handles multiline message", () => {
      const commit: Commit = {
        ...sampleCommit,
        message: "First line\n\nSecond paragraph\n\nThird paragraph",
      };

      const serialized = serializeCommit(commit);
      const parsed = parseCommit(serialized);

      expect(parsed.message).toBe(commit.message);
    });
  });
});
