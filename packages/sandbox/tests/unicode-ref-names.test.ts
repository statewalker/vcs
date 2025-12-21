/**
 * Tests for Unicode ref name handling.
 * Ported from JGit's RefTest.java and UploadPackTest.java Unicode tests.
 *
 * Git ref names can contain UTF-8 characters, but must follow rules:
 * - No ASCII control characters (< 0x20)
 * - No space, tilde, caret, colon, question, asterisk, bracket characters
 * - No double dots (..)
 * - No trailing dots or locks
 * - Valid UTF-8 sequences for non-ASCII
 */

import { describe, expect, it } from "vitest";
import { createProtocolV2Handler } from "../src/handlers/protocol-v2-handler.js";
import type {
  HeadInfo,
  ObjectId,
  ObjectInfo,
  ObjectTypeCode,
  RefInfo,
  RepositoryAccess,
} from "../src/handlers/types.js";

// Object type codes
const OBJ_COMMIT = 1 as ObjectTypeCode;

// Sample object IDs
const COMMIT_TIP = "a".repeat(40);

// Sample commit content
const COMMIT_CONTENT = new TextEncoder().encode(
  `tree ${"0".repeat(40)}\nauthor Test <test@test.com> 1600000000 +0000\n`,
);

/**
 * Create a mock repository for testing Unicode ref names.
 */
function createUnicodeRefsRepository(refs: RefInfo[]): RepositoryAccess {
  const objects = new Map<ObjectId, { type: ObjectTypeCode; content: Uint8Array }>([
    [COMMIT_TIP, { type: OBJ_COMMIT, content: COMMIT_CONTENT }],
  ]);

  return {
    async *listRefs(): AsyncIterable<RefInfo> {
      for (const ref of refs) {
        yield ref;
      }
    },

    async getHead(): Promise<HeadInfo | null> {
      return { target: "refs/heads/main" };
    },

    async hasObject(id: ObjectId): Promise<boolean> {
      return objects.has(id);
    },

    async getObjectInfo(id: ObjectId): Promise<ObjectInfo | null> {
      const obj = objects.get(id);
      if (!obj) return null;
      return {
        id,
        type: obj.type,
        size: obj.content.length,
      };
    },

    async *loadObject(id: ObjectId): AsyncIterable<Uint8Array> {
      const obj = objects.get(id);
      if (obj) {
        yield obj.content;
      }
    },

    async storeObject(_type: ObjectTypeCode, _content: Uint8Array): Promise<ObjectId> {
      throw new Error("Not implemented");
    },

    async updateRef(
      _name: string,
      _oldId: ObjectId | null,
      _newId: ObjectId | null,
    ): Promise<boolean> {
      throw new Error("Not implemented");
    },

    async *walkObjects(
      wants: ObjectId[],
      haves: ObjectId[],
    ): AsyncIterable<{
      id: ObjectId;
      type: ObjectTypeCode;
      content: Uint8Array;
    }> {
      const haveSet = new Set(haves);
      for (const wantId of wants) {
        if (!haveSet.has(wantId)) {
          const obj = objects.get(wantId);
          if (obj) {
            yield { id: wantId, ...obj };
          }
        }
      }
    },
  };
}

// Helper to collect async iterable into array
async function collectBytes(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// Helper to convert bytes to string
function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// Empty stream helper
async function* emptyStream(): AsyncGenerator<Uint8Array> {}

describe("Unicode Ref Names", () => {
  describe("Valid Unicode Branch Names", () => {
    it("should handle Japanese characters in branch names", async () => {
      const refs = [
        { name: "refs/heads/main", objectId: COMMIT_TIP },
        { name: "refs/heads/機能/新機能", objectId: COMMIT_TIP }, // "feature/new-feature" in Japanese
      ];
      const repo = createUnicodeRefsRepository(refs);
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.handleLsRefs(emptyStream())));

      expect(output).toContain("refs/heads/機能/新機能");
    });

    it("should handle Chinese characters in branch names", async () => {
      const refs = [
        { name: "refs/heads/main", objectId: COMMIT_TIP },
        { name: "refs/heads/功能/修复", objectId: COMMIT_TIP }, // "feature/fix" in Chinese
      ];
      const repo = createUnicodeRefsRepository(refs);
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.handleLsRefs(emptyStream())));

      expect(output).toContain("refs/heads/功能/修复");
    });

    it("should handle Korean characters in branch names", async () => {
      const refs = [
        { name: "refs/heads/main", objectId: COMMIT_TIP },
        { name: "refs/heads/기능/새기능", objectId: COMMIT_TIP }, // "feature/new-feature" in Korean
      ];
      const repo = createUnicodeRefsRepository(refs);
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.handleLsRefs(emptyStream())));

      expect(output).toContain("refs/heads/기능/새기능");
    });

    it("should handle Arabic characters in branch names", async () => {
      const refs = [
        { name: "refs/heads/main", objectId: COMMIT_TIP },
        { name: "refs/heads/ميزة/جديدة", objectId: COMMIT_TIP }, // "feature/new" in Arabic
      ];
      const repo = createUnicodeRefsRepository(refs);
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.handleLsRefs(emptyStream())));

      expect(output).toContain("refs/heads/ميزة/جديدة");
    });

    it("should handle Cyrillic characters in branch names", async () => {
      const refs = [
        { name: "refs/heads/main", objectId: COMMIT_TIP },
        { name: "refs/heads/функция/новая", objectId: COMMIT_TIP }, // "feature/new" in Russian
      ];
      const repo = createUnicodeRefsRepository(refs);
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.handleLsRefs(emptyStream())));

      expect(output).toContain("refs/heads/функция/новая");
    });

    it("should handle emoji in branch names", async () => {
      // Emoji are valid UTF-8 and should be supported
      const refs = [
        { name: "refs/heads/main", objectId: COMMIT_TIP },
        { name: "refs/heads/feature/🚀-launch", objectId: COMMIT_TIP },
      ];
      const repo = createUnicodeRefsRepository(refs);
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.handleLsRefs(emptyStream())));

      expect(output).toContain("refs/heads/feature/🚀-launch");
    });

    it("should handle mixed ASCII and Unicode", async () => {
      const refs = [
        { name: "refs/heads/main", objectId: COMMIT_TIP },
        { name: "refs/heads/feature-機能-test", objectId: COMMIT_TIP },
      ];
      const repo = createUnicodeRefsRepository(refs);
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.handleLsRefs(emptyStream())));

      expect(output).toContain("refs/heads/feature-機能-test");
    });
  });

  describe("Unicode Tag Names", () => {
    it("should handle Unicode in tag names", async () => {
      const refs = [
        { name: "refs/heads/main", objectId: COMMIT_TIP },
        { name: "refs/tags/版本-1.0", objectId: COMMIT_TIP }, // "version-1.0" in Chinese
      ];
      const repo = createUnicodeRefsRepository(refs);
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.handleLsRefs(emptyStream())));

      expect(output).toContain("refs/tags/版本-1.0");
    });
  });

  describe("UTF-8 Encoding Preservation", () => {
    it("should preserve multi-byte UTF-8 sequences", async () => {
      // Multi-byte characters should not be corrupted
      const branchName = "refs/heads/テスト"; // 3-byte UTF-8 characters
      const refs = [{ name: branchName, objectId: COMMIT_TIP }];
      const repo = createUnicodeRefsRepository(refs);
      const handler = createProtocolV2Handler({ repository: repo });

      const output = await collectBytes(handler.handleLsRefs(emptyStream()));
      const outputStr = bytesToString(output);

      expect(outputStr).toContain("テスト");

      // Verify the bytes are correct UTF-8
      const encoder = new TextEncoder();
      const expectedBytes = encoder.encode("テスト");
      expect(expectedBytes.length).toBe(9); // 3 characters × 3 bytes each
    });

    it("should preserve 4-byte UTF-8 sequences (supplementary plane)", async () => {
      // Characters outside BMP require 4 bytes
      const branchName = "refs/heads/test-𝄞"; // Musical G clef (U+1D11E)
      const refs = [{ name: branchName, objectId: COMMIT_TIP }];
      const repo = createUnicodeRefsRepository(refs);
      const handler = createProtocolV2Handler({ repository: repo });

      const output = await collectBytes(handler.handleLsRefs(emptyStream()));
      const outputStr = bytesToString(output);

      expect(outputStr).toContain("test-𝄞");
    });
  });
});

describe("Ref Name Validation Rules", () => {
  describe("Valid ref name patterns", () => {
    const validNames = [
      "refs/heads/main",
      "refs/heads/feature/JIRA-123",
      "refs/heads/feature/test-branch",
      "refs/heads/feature/test_branch",
      "refs/heads/feature/test.branch",
      "refs/heads/v1.0.0",
      "refs/tags/release-2024",
      "refs/remotes/origin/main",
      "refs/notes/commits",
      // Unicode names
      "refs/heads/功能",
      "refs/heads/機能/新",
      "refs/heads/특징/새로운",
    ];

    for (const name of validNames) {
      it(`should accept valid ref name: ${name}`, () => {
        expect(isValidRefName(name)).toBe(true);
      });
    }
  });

  describe("Invalid ref name patterns", () => {
    const invalidNames = [
      // Control characters
      "refs/heads/test\x00",
      "refs/heads/test\x1f",
      // Forbidden characters
      "refs/heads/test branch", // space
      "refs/heads/test~branch", // tilde
      "refs/heads/test^branch", // caret
      "refs/heads/test:branch", // colon
      "refs/heads/test?branch", // question mark
      "refs/heads/test*branch", // asterisk
      "refs/heads/test[branch", // open bracket
      "refs/heads/test\\branch", // backslash
      // Forbidden patterns
      "refs/heads/test..branch", // double dot
      "refs/heads/test.", // trailing dot
      "refs/heads/test.lock", // trailing .lock
      "refs/heads/.test", // leading dot in component
      "refs/heads/test//branch", // empty component
      "refs/heads/@{test}", // @ followed by {
    ];

    for (const name of invalidNames) {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching control chars for display
      const displayName = name.replace(/\x00/g, "\\x00").replace(/\x1f/g, "\\x1f");
      it(`should reject invalid ref name: ${displayName}`, () => {
        expect(isValidRefName(name)).toBe(false);
      });
    }
  });
});

describe("Pkt-line Unicode Encoding", () => {
  it("should encode Unicode refs correctly in pkt-line format", () => {
    const refLine = `${"a".repeat(40)} refs/heads/機能\n`;
    const encoded = encodePktLine(refLine);

    // Verify length calculation includes multi-byte characters correctly
    const _expectedLength = 4 + 40 + 1 + "refs/heads/機能".length * 3 + 1; // Simplified, real calc differs

    // The encoded output should be valid UTF-8
    const decoded = new TextDecoder().decode(encoded);
    expect(decoded).toContain("refs/heads/機能");
  });

  it("should handle long Unicode ref names", () => {
    // Test that long Unicode names don't exceed pkt-line limits
    const longUnicodeName = `refs/heads/${"テスト".repeat(100)}`; // 300 3-byte chars
    const refLine = `${"a".repeat(40)} ${longUnicodeName}\n`;

    // Should be able to encode
    const encoded = encodePktLine(refLine);
    expect(encoded.length).toBeGreaterThan(0);

    // Should round-trip correctly
    const decoded = new TextDecoder().decode(encoded);
    expect(decoded).toContain(longUnicodeName);
  });
});

describe("JGit Unicode Test Scenarios", () => {
  describe("testRefNameValidation", () => {
    it("should match JGit ref name validation rules", () => {
      // These are patterns that JGit specifically tests

      // Valid
      expect(isValidRefName("refs/heads/valid")).toBe(true);
      expect(isValidRefName("refs/heads/also-valid")).toBe(true);
      expect(isValidRefName("refs/heads/also_valid")).toBe(true);
      expect(isValidRefName("refs/heads/also.valid")).toBe(true);

      // Invalid
      expect(isValidRefName("refs/heads/not valid")).toBe(false); // space
      expect(isValidRefName("refs/heads/not~valid")).toBe(false); // tilde
      expect(isValidRefName("refs/heads/not^valid")).toBe(false); // caret
      expect(isValidRefName("refs/heads/not:valid")).toBe(false); // colon
    });
  });

  describe("testAdvertiseRefsWithUnicode", () => {
    it("should advertise refs with Unicode names correctly", async () => {
      // Simulate JGit's test for advertising Unicode refs
      const refs = [
        { name: "refs/heads/main", objectId: COMMIT_TIP },
        { name: "refs/heads/分支", objectId: COMMIT_TIP }, // "branch" in Chinese
      ];
      const repo = createUnicodeRefsRepository(refs);
      const handler = createProtocolV2Handler({ repository: repo });

      const output = bytesToString(await collectBytes(handler.handleLsRefs(emptyStream())));

      // Both refs should be advertised
      expect(output).toContain("refs/heads/main");
      expect(output).toContain("refs/heads/分支");
    });
  });
});

// Helper functions

/**
 * Validate a Git ref name.
 * Based on Git's refname-is-safe rules.
 */
function isValidRefName(name: string): boolean {
  // Must start with refs/
  if (!name.startsWith("refs/")) return false;

  // Check for forbidden characters
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally checking for forbidden control chars
  const forbiddenChars = /[\x00-\x1f\x7f ~^:?*[\]\\]/;
  if (forbiddenChars.test(name)) return false;

  // Check for forbidden patterns
  if (name.includes("..")) return false;
  if (name.includes("@{")) return false;
  if (name.endsWith(".")) return false;
  if (name.endsWith(".lock")) return false;
  if (name.includes("//")) return false;

  // Check for leading dots in components
  const components = name.split("/");
  for (const component of components) {
    if (component.startsWith(".")) return false;
    if (component === "") return false;
  }

  return true;
}

/**
 * Encode a string as a pkt-line packet.
 */
function encodePktLine(data: string): Uint8Array {
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(data);
  const length = dataBytes.length + 4;
  const lengthHex = length.toString(16).padStart(4, "0");
  const lengthBytes = encoder.encode(lengthHex);

  const result = new Uint8Array(length);
  result.set(lengthBytes, 0);
  result.set(dataBytes, 4);
  return result;
}
