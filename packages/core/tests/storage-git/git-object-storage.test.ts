import { beforeEach, describe, expect, it } from "vitest";
import { concatArrays, parseHeader } from "../../src/storage-git/git-format.js";
import {
  GitObjectStorage,
  ObjectType,
  toAsyncIterable,
} from "../../src/storage-git/git-object-storage.js";
import { createMemoryStorage as createDefaultObjectStorage } from "../../src/storage-impl/index.js";

describe("GitObjectStorage", () => {
  let gitStorage: GitObjectStorage;

  beforeEach(() => {
    // Create a fresh storage with SHA-1 for Git compatibility
    const baseStorage = createDefaultObjectStorage({ hashAlgorithm: "SHA-1" });
    gitStorage = new GitObjectStorage(baseStorage);
  });

  describe("constructor", () => {
    it("should create instance with ObjectStorage", () => {
      const baseStorage = createDefaultObjectStorage();
      const storage = new GitObjectStorage(baseStorage);
      expect(storage).toBeInstanceOf(GitObjectStorage);
    });
  });

  describe("storeTypedBytes / loadTypedBytes", () => {
    it("should store and load blob", async () => {
      const content = new TextEncoder().encode("Hello, World!");
      const id = await gitStorage.storeTypedBytes(ObjectType.BLOB, content);

      expect(id).toBeDefined();
      expect(typeof id).toBe("string");

      const loaded = await gitStorage.loadTypedBytes(id);
      expect(loaded.type).toBe(ObjectType.BLOB);
      expect(loaded.size).toBe(content.length);
      expect(new TextDecoder().decode(loaded.content)).toBe("Hello, World!");
    });

    it("should store and load commit", async () => {
      const content = new TextEncoder().encode("tree abc123\nparent def456\nauthor Test");
      const id = await gitStorage.storeTypedBytes(ObjectType.COMMIT, content);

      const loaded = await gitStorage.loadTypedBytes(id);
      expect(loaded.type).toBe(ObjectType.COMMIT);
      expect(loaded.size).toBe(content.length);
      expect(loaded.content).toEqual(content);
    });

    it("should store and load tree", async () => {
      const content = new TextEncoder().encode(`100644 file.txt\0${"\x00".repeat(20)}`);
      const id = await gitStorage.storeTypedBytes(ObjectType.TREE, content);

      const loaded = await gitStorage.loadTypedBytes(id);
      expect(loaded.type).toBe(ObjectType.TREE);
      expect(loaded.size).toBe(content.length);
    });

    it("should store and load tag", async () => {
      const content = new TextEncoder().encode("object abc123\ntype commit\ntag v1.0.0");
      const id = await gitStorage.storeTypedBytes(ObjectType.TAG, content);

      const loaded = await gitStorage.loadTypedBytes(id);
      expect(loaded.type).toBe(ObjectType.TAG);
      expect(loaded.size).toBe(content.length);
    });

    it("should store and load empty content", async () => {
      const content = new Uint8Array(0);
      const id = await gitStorage.storeTypedBytes(ObjectType.BLOB, content);

      const loaded = await gitStorage.loadTypedBytes(id);
      expect(loaded.type).toBe(ObjectType.BLOB);
      expect(loaded.size).toBe(0);
      expect(loaded.content.length).toBe(0);
    });

    it("should handle binary content", async () => {
      const content = new Uint8Array([0, 1, 2, 255, 254, 253, 0, 128, 127]);
      const id = await gitStorage.storeTypedBytes(ObjectType.BLOB, content);

      const loaded = await gitStorage.loadTypedBytes(id);
      expect(loaded.type).toBe(ObjectType.BLOB);
      expect(Array.from(loaded.content)).toEqual(Array.from(content));
    });

    it("should handle large content", async () => {
      const content = new Uint8Array(100000);
      for (let i = 0; i < content.length; i++) {
        content[i] = i % 256;
      }

      const id = await gitStorage.storeTypedBytes(ObjectType.BLOB, content);

      const loaded = await gitStorage.loadTypedBytes(id);
      expect(loaded.type).toBe(ObjectType.BLOB);
      expect(loaded.size).toBe(100000);
      expect(loaded.content.length).toBe(100000);
      expect(Array.from(loaded.content)).toEqual(Array.from(content));
    });
  });

  describe("storeTyped / loadTyped (streaming)", () => {
    it("should store from async iterable", async () => {
      const chunks = [new TextEncoder().encode("Hello, "), new TextEncoder().encode("World!")];

      const stream = (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();

      const id = await gitStorage.storeTyped(ObjectType.BLOB, stream);

      const loaded = await gitStorage.loadTypedBytes(id);
      expect(loaded.type).toBe(ObjectType.BLOB);
      expect(new TextDecoder().decode(loaded.content)).toBe("Hello, World!");
    });

    it("should load as streaming content", async () => {
      const content = new TextEncoder().encode("Streaming content test");
      const id = await gitStorage.storeTypedBytes(ObjectType.BLOB, content);

      const loaded = await gitStorage.loadTyped(id);
      expect(loaded.type).toBe(ObjectType.BLOB);
      expect(loaded.size).toBe(content.length);

      // Collect content from stream
      const chunks: Uint8Array[] = [];
      for await (const chunk of loaded.content) {
        chunks.push(chunk);
      }
      const fullContent = concatArrays(chunks);
      expect(new TextDecoder().decode(fullContent)).toBe("Streaming content test");
    });

    it("should handle multi-chunk streaming", async () => {
      const stream = (async function* () {
        yield new Uint8Array([1, 2, 3]);
        yield new Uint8Array([4, 5, 6]);
        yield new Uint8Array([7, 8, 9]);
      })();

      const id = await gitStorage.storeTyped(ObjectType.BLOB, stream);

      const loaded = await gitStorage.loadTypedBytes(id);
      expect(loaded.size).toBe(9);
      expect(Array.from(loaded.content)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });

  describe("has", () => {
    it("should return true for existing object", async () => {
      const content = new TextEncoder().encode("test");
      const id = await gitStorage.storeTypedBytes(ObjectType.BLOB, content);

      expect(await gitStorage.has(id)).toBe(true);
    });

    it("should return false for non-existing object", async () => {
      expect(await gitStorage.has("0000000000000000000000000000000000000000")).toBe(false);
    });
  });

  describe("delete", () => {
    it("should delete existing object", async () => {
      const content = new TextEncoder().encode("to be deleted");
      const id = await gitStorage.storeTypedBytes(ObjectType.BLOB, content);

      expect(await gitStorage.has(id)).toBe(true);

      const deleted = await gitStorage.delete(id);
      expect(deleted).toBe(true);

      expect(await gitStorage.has(id)).toBe(false);
    });

    it("should return false for non-existing object", async () => {
      const deleted = await gitStorage.delete("0000000000000000000000000000000000000000");
      expect(deleted).toBe(false);
    });
  });

  describe("raw accessor", () => {
    it("should provide access to underlying storage", () => {
      const baseStorage = createDefaultObjectStorage();
      const gitStorage = new GitObjectStorage(baseStorage);

      expect(gitStorage.raw).toBe(baseStorage);
    });

    it("should allow raw storage operations", async () => {
      const baseStorage = createDefaultObjectStorage();
      const gitStorage = new GitObjectStorage(baseStorage);

      // Store directly via raw storage (without Git header)
      const rawContent = new TextEncoder().encode("raw content");
      const { id: rawId } = await gitStorage.raw.store(toAsyncIterable(rawContent));

      expect(await gitStorage.raw.getInfo(rawId)).not.toBeNull();

      // Load raw content
      const chunks: Uint8Array[] = [];
      for await (const chunk of gitStorage.raw.load(rawId)) {
        chunks.push(chunk);
      }
      const loaded = concatArrays(chunks);
      expect(new TextDecoder().decode(loaded)).toBe("raw content");
    });
  });

  describe("content-addressability", () => {
    it("should return same ID for same content", async () => {
      const content = new TextEncoder().encode("identical content");

      const id1 = await gitStorage.storeTypedBytes(ObjectType.BLOB, content);
      const id2 = await gitStorage.storeTypedBytes(ObjectType.BLOB, content);

      expect(id1).toBe(id2);
    });

    it("should return different ID for different content", async () => {
      const content1 = new TextEncoder().encode("content 1");
      const content2 = new TextEncoder().encode("content 2");

      const id1 = await gitStorage.storeTypedBytes(ObjectType.BLOB, content1);
      const id2 = await gitStorage.storeTypedBytes(ObjectType.BLOB, content2);

      expect(id1).not.toBe(id2);
    });

    it("should return different ID for same content but different type", async () => {
      const content = new TextEncoder().encode("same content");

      const blobId = await gitStorage.storeTypedBytes(ObjectType.BLOB, content);
      const commitId = await gitStorage.storeTypedBytes(ObjectType.COMMIT, content);

      expect(blobId).not.toBe(commitId);
    });
  });

  describe("Git format compliance", () => {
    it("should store data in Git object format", async () => {
      const content = new TextEncoder().encode("test content");
      const id = await gitStorage.storeTypedBytes(ObjectType.BLOB, content);

      // Load raw data to verify format
      const chunks: Uint8Array[] = [];
      for await (const chunk of gitStorage.raw.load(id)) {
        chunks.push(chunk);
      }
      const rawData = concatArrays(chunks);

      // Parse the header
      const header = parseHeader(rawData);
      expect(header.type).toBe(ObjectType.BLOB);
      expect(header.size).toBe(content.length);

      // Verify content after header
      const storedContent = rawData.subarray(header.contentOffset);
      expect(new TextDecoder().decode(storedContent)).toBe("test content");
    });

    it("should produce correct header format", async () => {
      const content = new TextEncoder().encode("hello");
      const id = await gitStorage.storeTypedBytes(ObjectType.BLOB, content);

      const chunks: Uint8Array[] = [];
      for await (const chunk of gitStorage.raw.load(id)) {
        chunks.push(chunk);
      }
      const rawData = concatArrays(chunks);

      // Expected format: "blob 5\0hello"
      const expectedHeader = new TextEncoder().encode("blob 5\0");
      const actualHeader = rawData.subarray(0, expectedHeader.length);
      expect(Array.from(actualHeader)).toEqual(Array.from(expectedHeader));
    });
  });

  describe("error handling", () => {
    it("should throw when loading non-existing object", async () => {
      await expect(
        gitStorage.loadTyped("0000000000000000000000000000000000000000"),
      ).rejects.toThrow();
    });

    it("should throw when loading non-existing object bytes", async () => {
      await expect(
        gitStorage.loadTypedBytes("0000000000000000000000000000000000000000"),
      ).rejects.toThrow();
    });
  });

  describe("toAsyncIterable helper", () => {
    it("should convert Uint8Array to async iterable", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const iterable = toAsyncIterable(data);

      const chunks: Uint8Array[] = [];
      for await (const chunk of iterable) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
      expect(Array.from(chunks[0])).toEqual([1, 2, 3, 4, 5]);
    });

    it("should handle empty array", async () => {
      const data = new Uint8Array(0);
      const iterable = toAsyncIterable(data);

      const chunks: Uint8Array[] = [];
      for await (const chunk of iterable) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
      expect(chunks[0].length).toBe(0);
    });
  });
});

describe("GitObjectStorage with default hashing", () => {
  let gitStorage: GitObjectStorage;

  beforeEach(() => {
    // Create storage with default settings (SHA-1)
    const baseStorage = createDefaultObjectStorage();
    gitStorage = new GitObjectStorage(baseStorage);
  });

  it("should work with default hashing", async () => {
    const content = new TextEncoder().encode("default hash test");
    const id = await gitStorage.storeTypedBytes(ObjectType.BLOB, content);

    // SHA-1 produces 40-character hex string
    expect(id.length).toBe(40);

    const loaded = await gitStorage.loadTypedBytes(id);
    expect(loaded.type).toBe(ObjectType.BLOB);
    expect(new TextDecoder().decode(loaded.content)).toBe("default hash test");
  });
});
