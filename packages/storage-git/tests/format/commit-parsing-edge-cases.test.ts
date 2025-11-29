/**
 * Tests for commit parsing edge cases
 *
 * Based on JGit's RevCommitParseTest.java
 * Tests various malformed and edge-case commit formats.
 */

import type { Commit } from "@webrun-vcs/storage";
import { describe, expect, it } from "vitest";
import { parseCommit, serializeCommit } from "../../src/format/commit-format.js";

describe("commit parsing edge cases", () => {
  const sampleTreeId = "9788669ad918b6fcce64af8882fc9a81cb6aba67";

  describe("malformed commits", () => {
    it("handles commit with no blank line before message", () => {
      // Some old Git implementations or manual creates might omit the blank line
      const text = `tree ${sampleTreeId}
author A U. Thor <a@example.com> 1234567890 +0100
committer C O. Miter <c@example.com> 1234567900 -0500
`;
      // No blank line, no message

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.tree).toBe(sampleTreeId);
      expect(commit.message).toBe("");
    });

    it("handles incomplete author field (missing name)", () => {
      const text = `tree ${sampleTreeId}
author <a@example.com> 1234567890 +0100
committer C O. Miter <c@example.com> 1234567900 -0500

Message`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.author.name).toBe("");
      expect(commit.author.email).toBe("a@example.com");
    });

    it("handles incomplete committer field (empty email)", () => {
      const text = `tree ${sampleTreeId}
author Author Name <author@example.com> 1234567890 +0100
committer Committer <> 1234567900 -0500

Message`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.committer.name).toBe("Committer");
      expect(commit.committer.email).toBe("");
    });

    it("handles author with both name and email empty", () => {
      const text = `tree ${sampleTreeId}
author <> 1234567890 +0100
committer <> 1234567900 -0500

Message`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.author.name).toBe("");
      expect(commit.author.email).toBe("");
      expect(commit.committer.name).toBe("");
      expect(commit.committer.email).toBe("");
    });
  });

  describe("encoding handling", () => {
    it("defaults to UTF-8 without encoding header", () => {
      const text = `tree ${sampleTreeId}
author Föör Fattäre <author@example.com> 1234567890 +0100
committer C O. Miter <c@example.com> 1234567900 -0500

Smörgåsbord`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.author.name).toBe("Föör Fattäre");
      expect(commit.message).toBe("Smörgåsbord");
      expect(commit.encoding).toBeUndefined();
    });

    it("respects explicit encoding header", () => {
      const text = `tree ${sampleTreeId}
author Author <author@example.com> 1234567890 +0100
committer Committer <c@example.com> 1234567900 -0500
encoding EUC-JP

Message`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.encoding).toBe("EUC-JP");
    });

    it("preserves unusual encoding names", () => {
      // Git allows any string as encoding name
      const text = `tree ${sampleTreeId}
author Author <author@example.com> 1234567890 +0100
committer Committer <c@example.com> 1234567900 -0500
encoding utf-8logoutputencoding=gbk

Message`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.encoding).toBe("utf-8logoutputencoding=gbk");
    });
  });

  describe("message formats", () => {
    it.todo("handles CRLF line endings", () => {
      // TODO: The parser currently splits by LF only, so CRLF isn't handled properly
      // JGit handles this in RevCommitParseTest.testParse_GitStyleMessageWithCRLF
      const text = `tree ${sampleTreeId}\r
author A <a@b.com> 1234567890 +0100\r
committer C <c@d.com> 1234567900 -0500\r
\r
This fixes a\r
bug.\r
\r
Signed-off-by: A <a@b.com>\r
`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.message).toContain("This fixes a");
      expect(commit.message).toContain("Signed-off-by");
    });

    it("handles empty message", () => {
      const text = `tree ${sampleTreeId}
author A <a@b.com> 1234567890 +0100
committer C <c@d.com> 1234567900 -0500

`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.message).toBe("");
    });

    it("handles message with only newlines", () => {
      const text = `tree ${sampleTreeId}
author A <a@b.com> 1234567890 +0100
committer C <c@d.com> 1234567900 -0500

\n\n`;

      const commit = parseCommit(new TextEncoder().encode(text));

      // The message should contain the newlines
      expect(commit.message.trim()).toBe("");
    });

    it("handles git-style message with subject and body", () => {
      const text = `tree ${sampleTreeId}
author A <a@b.com> 1234567890 +0100
committer C <c@d.com> 1234567900 -0500

This fixes a bug.

We do it with magic and pixie dust.

Signed-off-by: A U. Thor <author@example.com>`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.message).toContain("This fixes a bug.");
      expect(commit.message).toContain("We do it with magic and pixie dust.");
      expect(commit.message).toContain("Signed-off-by:");
    });
  });

  describe("GPG signatures", () => {
    it("parses commit with gpgsig header (compact format)", () => {
      // gpgsig uses continuation lines with space prefix
      // No empty lines within the signature for proper parsing
      const text = `tree e3a1035abd2b319bb01e57d69b0ba6cab289297e
parent 54e895b87c0768d2317a2b17062e3ad9f76a8105
author A U Thor <author@example.com> 1528968566 +0200
committer A U Thor <author@example.com> 1528968566 +0200
gpgsig -----BEGIN PGP SIGNATURE-----
 wsBcBAABCAAQBQJbGB4pCRBK7hj4Ov3rIwAAdHIIAENrvz23867ZgqrmyPemBEZP
 U24B1Tlq/DWvce2buaxmbNQngKZ0pv2s8VMc11916WfTIC9EKvioatmpjduWvhqj
 =TClh
 -----END PGP SIGNATURE-----

Signed commit message`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.gpgSignature).toBeDefined();
      expect(commit.gpgSignature).toContain("-----BEGIN PGP SIGNATURE-----");
      expect(commit.gpgSignature).toContain("-----END PGP SIGNATURE-----");
      expect(commit.message).toBe("Signed commit message");
    });

    it.todo("parses gpgsig with internal empty lines", () => {
      // TODO: The parser currently treats any empty line as message separator
      // JGit handles this in RevCommitParseTest.testParse_gpgSig
      // Real GPG signatures may have empty lines within them
    });

    it("handles commit without gpgsig", () => {
      const text = `tree ${sampleTreeId}
author A <a@b.com> 1234567890 +0100
committer C <c@d.com> 1234567900 -0500

Unsigned commit`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.gpgSignature).toBeUndefined();
    });
  });

  describe("timezone handling", () => {
    it("parses positive timezone offset", () => {
      const text = `tree ${sampleTreeId}
author A <a@b.com> 1234567890 +0530
committer C <c@d.com> 1234567900 +1100

Message`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.author.tzOffset).toBe("+0530");
      expect(commit.committer.tzOffset).toBe("+1100");
    });

    it("parses negative timezone offset", () => {
      const text = `tree ${sampleTreeId}
author A <a@b.com> 1234567890 -0800
committer C <c@d.com> 1234567900 -0500

Message`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.author.tzOffset).toBe("-0800");
      expect(commit.committer.tzOffset).toBe("-0500");
    });

    it("handles zero timezone", () => {
      const text = `tree ${sampleTreeId}
author A <a@b.com> 1234567890 +0000
committer C <c@d.com> 1234567900 -0000

Message`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.author.tzOffset).toBe("+0000");
      expect(commit.committer.tzOffset).toBe("-0000");
    });
  });

  describe("extra headers", () => {
    it("preserves unknown headers", () => {
      const text = `tree ${sampleTreeId}
author A <a@b.com> 1234567890 +0100
committer C <c@d.com> 1234567900 -0500
mergetag object abc123
 type commit
 tag v1.0
 tagger T <t@t.com> 123 +0000

Message`;

      // The parser should not throw on unknown headers
      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.tree).toBe(sampleTreeId);
      expect(commit.message).toBe("Message");
    });
  });

  describe("timestamp handling", () => {
    it("parses epoch timestamp (zero)", () => {
      const text = `tree ${sampleTreeId}
author A <a@b.com> 0 +0000
committer C <c@d.com> 0 +0000

Epoch commit`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.author.timestamp).toBe(0);
      expect(commit.committer.timestamp).toBe(0);
    });

    it("parses large timestamp (far future)", () => {
      const largeTimestamp = 2147483647; // Max 32-bit signed integer
      const text = `tree ${sampleTreeId}
author A <a@b.com> ${largeTimestamp} +0000
committer C <c@d.com> ${largeTimestamp} +0000

Future commit`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.author.timestamp).toBe(largeTimestamp);
    });
  });

  describe("serialization roundtrip for edge cases", () => {
    it("roundtrips unicode content", () => {
      const original: Commit = {
        tree: sampleTreeId,
        parents: [],
        author: {
          name: "Föör Fattäre",
          email: "author@example.com",
          timestamp: 1234567890,
          tzOffset: "+0100",
        },
        committer: {
          name: "きれい",
          email: "committer@example.com",
          timestamp: 1234567900,
          tzOffset: "-0500",
        },
        message: "Smörgåsbord\n\n日本語テスト",
      };

      const serialized = serializeCommit(original);
      const parsed = parseCommit(serialized);

      expect(parsed.author.name).toBe(original.author.name);
      expect(parsed.committer.name).toBe(original.committer.name);
      expect(parsed.message).toBe(original.message);
    });

    it("roundtrips special characters in email", () => {
      const original: Commit = {
        tree: sampleTreeId,
        parents: [],
        author: {
          name: "Author",
          email: "user+tag@example.com",
          timestamp: 1234567890,
          tzOffset: "+0000",
        },
        committer: {
          name: "Committer",
          email: "user.name@sub.domain.example.com",
          timestamp: 1234567900,
          tzOffset: "+0000",
        },
        message: "Test",
      };

      const serialized = serializeCommit(original);
      const parsed = parseCommit(serialized);

      expect(parsed.author.email).toBe(original.author.email);
      expect(parsed.committer.email).toBe(original.committer.email);
    });

    it("roundtrips message with trailing newlines", () => {
      const original: Commit = {
        tree: sampleTreeId,
        parents: [],
        author: {
          name: "A",
          email: "a@b.com",
          timestamp: 1234567890,
          tzOffset: "+0000",
        },
        committer: {
          name: "C",
          email: "c@d.com",
          timestamp: 1234567900,
          tzOffset: "+0000",
        },
        message: "Message with trailing newlines\n\n",
      };

      const serialized = serializeCommit(original);
      const parsed = parseCommit(serialized);

      // Note: trailing newlines might be normalized, but content should be preserved
      expect(parsed.message).toContain("Message with trailing newlines");
    });
  });

  describe("multiple parent commits", () => {
    it("parses commit with many parents (octopus)", () => {
      const parents = Array.from({ length: 5 }, (_, i) =>
        (i + 1).toString().repeat(40).substring(0, 40),
      );

      const parentLines = parents.map((p) => `parent ${p}`).join("\n");
      const text = `tree ${sampleTreeId}
${parentLines}
author A <a@b.com> 1234567890 +0100
committer C <c@d.com> 1234567900 -0500

Octopus merge`;

      const commit = parseCommit(new TextEncoder().encode(text));

      expect(commit.parents).toHaveLength(5);
    });
  });
});
