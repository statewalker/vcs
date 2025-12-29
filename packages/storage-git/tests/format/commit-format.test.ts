/**
 * Tests for Git commit format serialization/parsing
 */

import type { Commit, PersonIdent } from "@webrun-vcs/core";
import { describe, expect, it } from "vitest";
import { parseCommit, serializeCommit } from "../../src/format/commit-format.js";

describe("commit-format", () => {
  const sampleAuthor: PersonIdent = {
    name: "John Doe",
    email: "john@example.com",
    timestamp: 1234567890,
    tzOffset: "+0100",
  };

  const sampleCommitter: PersonIdent = {
    name: "Jane Smith",
    email: "jane@example.com",
    timestamp: 1234567900,
    tzOffset: "-0500",
  };

  const sampleTreeId = "a".repeat(40);
  const sampleParentId = "b".repeat(40);

  describe("serializeCommit", () => {
    it("serializes basic commit", () => {
      const commit: Commit = {
        tree: sampleTreeId,
        parents: [],
        author: sampleAuthor,
        committer: sampleCommitter,
        message: "Initial commit",
      };

      const result = serializeCommit(commit);
      const text = new TextDecoder().decode(result);

      expect(text).toContain(`tree ${sampleTreeId}`);
      expect(text).toContain("author John Doe <john@example.com>");
      expect(text).toContain("committer Jane Smith <jane@example.com>");
      expect(text).toContain("Initial commit");
      expect(text).not.toContain("parent");
    });

    it("serializes commit with one parent", () => {
      const commit: Commit = {
        tree: sampleTreeId,
        parents: [sampleParentId],
        author: sampleAuthor,
        committer: sampleCommitter,
        message: "Second commit",
      };

      const result = serializeCommit(commit);
      const text = new TextDecoder().decode(result);

      expect(text).toContain(`parent ${sampleParentId}`);
    });

    it("serializes merge commit with multiple parents", () => {
      const parentId2 = "c".repeat(40);
      const commit: Commit = {
        tree: sampleTreeId,
        parents: [sampleParentId, parentId2],
        author: sampleAuthor,
        committer: sampleCommitter,
        message: "Merge branch",
      };

      const result = serializeCommit(commit);
      const text = new TextDecoder().decode(result);

      expect(text).toContain(`parent ${sampleParentId}`);
      expect(text).toContain(`parent ${parentId2}`);
    });

    it("serializes multi-line message", () => {
      const commit: Commit = {
        tree: sampleTreeId,
        parents: [],
        author: sampleAuthor,
        committer: sampleCommitter,
        message: "First line\n\nDetailed description\nwith multiple lines",
      };

      const result = serializeCommit(commit);
      const text = new TextDecoder().decode(result);

      expect(text).toContain("First line\n\nDetailed description");
    });

    it("serializes commit with encoding", () => {
      const commit: Commit = {
        tree: sampleTreeId,
        parents: [],
        author: sampleAuthor,
        committer: sampleCommitter,
        message: "Message",
        encoding: "ISO-8859-1",
      };

      const result = serializeCommit(commit);
      const text = new TextDecoder().decode(result);

      expect(text).toContain("encoding ISO-8859-1");
    });

    it("omits encoding if UTF-8", () => {
      const commit: Commit = {
        tree: sampleTreeId,
        parents: [],
        author: sampleAuthor,
        committer: sampleCommitter,
        message: "Message",
        encoding: "utf-8",
      };

      const result = serializeCommit(commit);
      const text = new TextDecoder().decode(result);

      expect(text).not.toContain("encoding");
    });
  });

  describe("parseCommit", () => {
    it("parses basic commit", () => {
      const text = `tree ${sampleTreeId}
author John Doe <john@example.com> 1234567890 +0100
committer Jane Smith <jane@example.com> 1234567900 -0500

Initial commit`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.tree).toBe(sampleTreeId);
      expect(commit.parents).toHaveLength(0);
      expect(commit.author.name).toBe("John Doe");
      expect(commit.author.email).toBe("john@example.com");
      expect(commit.author.timestamp).toBe(1234567890);
      expect(commit.author.tzOffset).toBe("+0100");
      expect(commit.committer.name).toBe("Jane Smith");
      expect(commit.committer.timestamp).toBe(1234567900);
      expect(commit.message).toBe("Initial commit");
    });

    it("parses commit with parent", () => {
      const text = `tree ${sampleTreeId}
parent ${sampleParentId}
author John Doe <john@example.com> 1234567890 +0100
committer Jane Smith <jane@example.com> 1234567900 -0500

Second commit`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.parents).toHaveLength(1);
      expect(commit.parents[0]).toBe(sampleParentId);
    });

    it("parses merge commit", () => {
      const parentId2 = "c".repeat(40);
      const text = `tree ${sampleTreeId}
parent ${sampleParentId}
parent ${parentId2}
author John Doe <john@example.com> 1234567890 +0100
committer Jane Smith <jane@example.com> 1234567900 -0500

Merge commit`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.parents).toHaveLength(2);
      expect(commit.parents[0]).toBe(sampleParentId);
      expect(commit.parents[1]).toBe(parentId2);
    });

    it("parses multi-line message", () => {
      const text = `tree ${sampleTreeId}
author John Doe <john@example.com> 1234567890 +0100
committer John Doe <john@example.com> 1234567890 +0100

First line

Detailed description
with multiple lines`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.message).toBe("First line\n\nDetailed description\nwith multiple lines");
    });

    it("parses commit with encoding", () => {
      const text = `tree ${sampleTreeId}
author John Doe <john@example.com> 1234567890 +0100
committer John Doe <john@example.com> 1234567890 +0100
encoding ISO-8859-1

Message`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.encoding).toBe("ISO-8859-1");
    });

    it("throws for missing tree", () => {
      const text = `author John Doe <john@example.com> 1234567890 +0100
committer John Doe <john@example.com> 1234567890 +0100

Message`;

      expect(() => parseCommit(new TextEncoder().encode(text))).toThrow("missing tree");
    });

    it("throws for missing author", () => {
      const text = `tree ${sampleTreeId}
committer John Doe <john@example.com> 1234567890 +0100

Message`;

      expect(() => parseCommit(new TextEncoder().encode(text))).toThrow("missing author");
    });

    it("throws for missing committer", () => {
      const text = `tree ${sampleTreeId}
author John Doe <john@example.com> 1234567890 +0100

Message`;

      expect(() => parseCommit(new TextEncoder().encode(text))).toThrow("missing committer");
    });
  });

  describe("roundtrip", () => {
    it("preserves all fields", () => {
      const original: Commit = {
        tree: sampleTreeId,
        parents: [sampleParentId],
        author: sampleAuthor,
        committer: sampleCommitter,
        message: "Test commit\n\nWith details",
        encoding: "ISO-8859-1",
      };

      const serialized = serializeCommit(original);
      const parsed = parseCommit(serialized);

      expect(parsed.tree).toBe(original.tree);
      expect(parsed.parents).toEqual(original.parents);
      expect(parsed.author).toEqual(original.author);
      expect(parsed.committer).toEqual(original.committer);
      expect(parsed.message).toBe(original.message);
      expect(parsed.encoding).toBe(original.encoding);
    });

    it("preserves empty message", () => {
      const original: Commit = {
        tree: sampleTreeId,
        parents: [],
        author: sampleAuthor,
        committer: sampleCommitter,
        message: "",
      };

      const serialized = serializeCommit(original);
      const parsed = parseCommit(serialized);

      expect(parsed.message).toBe("");
    });
  });
});
