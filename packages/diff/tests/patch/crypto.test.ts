import { beforeEach, describe, expect, it } from "vitest";
import {
  type CryptoProvider,
  gitObjectHash,
  setDefaultCryptoProvider,
  sha1,
  sha256,
  WebCryptoProvider,
} from "../../src/common/crypto/index.js";

describe("crypto", () => {
  describe("WebCryptoProvider", () => {
    let provider: WebCryptoProvider;

    beforeEach(() => {
      provider = new WebCryptoProvider();
    });

    it("should compute SHA-1 hash", async () => {
      const data = new TextEncoder().encode("Hello, World!");
      const hash = await provider.hash("SHA-1", data);

      // Expected SHA-1 of "Hello, World!"
      expect(hash).toBe("0a0a9f2a6772942557ab5355d76af442f8f65e01");
      expect(hash).toHaveLength(40); // SHA-1 is 160 bits = 40 hex chars
    });

    it("should compute SHA-256 hash", async () => {
      const data = new TextEncoder().encode("Hello, World!");
      const hash = await provider.hash("SHA-256", data);

      // Expected SHA-256 of "Hello, World!"
      expect(hash).toBe("dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f");
      expect(hash).toHaveLength(64); // SHA-256 is 256 bits = 64 hex chars
    });

    it("should hash empty data", async () => {
      const data = new Uint8Array([]);
      const hash = await provider.hash("SHA-1", data);

      // SHA-1 of empty string
      expect(hash).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    });

    it("should hash binary data", async () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff]);
      const hash = await provider.hash("SHA-1", data);

      expect(hash).toHaveLength(40);
      expect(hash).toMatch(/^[0-9a-f]{40}$/);
    });

    it("should throw on synchronous hash", () => {
      const data = new TextEncoder().encode("test");
      expect(() => provider.hashSync("SHA-1", data)).toThrow(/does not support synchronous/);
    });
  });

  describe("sha1", () => {
    it("should compute SHA-1 hash using default provider", async () => {
      const data = new TextEncoder().encode("test");
      const hash = await sha1(data);

      // SHA-1 of "test"
      expect(hash).toBe("a94a8fe5ccb19ba61c4c0873d391e987982fbbd3");
    });

    it("should compute SHA-1 of empty string", async () => {
      const data = new Uint8Array([]);
      const hash = await sha1(data);

      expect(hash).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    });
  });

  describe("sha256", () => {
    it("should compute SHA-256 hash using default provider", async () => {
      const data = new TextEncoder().encode("test");
      const hash = await sha256(data);

      // SHA-256 of "test"
      expect(hash).toBe("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
    });
  });

  describe("gitObjectHash", () => {
    it("should compute Git blob hash", async () => {
      const content = new TextEncoder().encode("Hello, World!");
      const hash = await gitObjectHash("blob", content);

      // Git hash includes header: "blob 13\0Hello, World!"
      // This is a well-known hash
      expect(hash).toHaveLength(40);
      expect(hash).toMatch(/^[0-9a-f]{40}$/);
    });

    it("should compute hash with Git header format", async () => {
      const content = new TextEncoder().encode("test content\n");
      const hash = await gitObjectHash("blob", content);

      // Git adds "blob 13\0" prefix before hashing
      // Manual verification: echo -n "test content" | git hash-object --stdin
      expect(hash).toHaveLength(40);
    });

    it("should handle different object types", async () => {
      const content = new TextEncoder().encode("test");

      const blobHash = await gitObjectHash("blob", content);
      const treeHash = await gitObjectHash("tree", content);
      const commitHash = await gitObjectHash("commit", content);
      const tagHash = await gitObjectHash("tag", content);

      // Different types should produce different hashes
      expect(blobHash).not.toBe(treeHash);
      expect(blobHash).not.toBe(commitHash);
      expect(blobHash).not.toBe(tagHash);
    });

    it("should match Git's hash for known content", async () => {
      // Test case: empty file
      const content = new Uint8Array([]);
      const hash = await gitObjectHash("blob", content);

      // Git hash of empty file
      // $ git hash-object -t blob --stdin < /dev/null
      // e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
      expect(hash).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    });
  });

  describe("Custom CryptoProvider", () => {
    it("should allow custom provider", async () => {
      const customProvider: CryptoProvider = {
        async hash(algorithm, _data) {
          // Mock implementation
          return `custom-hash-${algorithm}`;
        },
        hashSync(algorithm, _data) {
          return `custom-hash-sync-${algorithm}`;
        },
      };

      setDefaultCryptoProvider(customProvider);

      const data = new TextEncoder().encode("test");
      const hash = await sha1(data);

      expect(hash).toBe("custom-hash-SHA-1");

      // Reset to default
      setDefaultCryptoProvider(new WebCryptoProvider());
    });
  });
});
