/**
 * Tests for GitNativeRepositoryAccess
 */

import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRawStore } from "../../src/storage/binary/raw-store.memory.js";
import { MemoryVolatileStore } from "../../src/storage/binary/volatile-store.memory.js";
import type { ObjectId } from "../../src/common/id/object-id.js";
import { GitObjectStoreImpl } from "../../src/history/objects/object-store.impl.js";
import type { GitObjectStore } from "../../src/history/objects/object-store.js";
import { ObjectType } from "../../src/history/objects/object-types.js";
import { GitNativeRepositoryAccess } from "../../src/repository-access/git-native-repository-access.js";

function createTestObjectStore(): GitObjectStore {
  const rawStore = new MemoryRawStore();
  const volatileStore = new MemoryVolatileStore();
  return new GitObjectStoreImpl(volatileStore, rawStore);
}

describe("GitNativeRepositoryAccess", () => {
  let objectStore: GitObjectStore;
  let access: GitNativeRepositoryAccess;

  beforeEach(() => {
    objectStore = createTestObjectStore();
    access = new GitNativeRepositoryAccess(objectStore);
  });

  describe("store and load", () => {
    it("stores and loads blob objects", async () => {
      const content = new TextEncoder().encode("Hello, World!");
      const id = await access.store(ObjectType.BLOB, content);

      expect(id).toBeDefined();
      expect(id.length).toBe(40); // SHA-1 hex

      const loaded = await access.load(id);
      expect(loaded).toBeDefined();
      expect(loaded?.type).toBe(ObjectType.BLOB);
      expect(loaded?.content).toEqual(content);
    });

    it("stores and loads tree objects", async () => {
      // Store a blob first
      const blobContent = new TextEncoder().encode("File content");
      const blobId = await access.store(ObjectType.BLOB, blobContent);

      // Create tree entry (simplified format for testing)
      const mode = new TextEncoder().encode("100644 ");
      const name = new TextEncoder().encode("file.txt\0");
      const hash = hexToBytes(blobId);

      const treeContent = new Uint8Array([...mode, ...name, ...hash]);
      const treeId = await access.store(ObjectType.TREE, treeContent);

      expect(treeId).toBeDefined();

      const loaded = await access.load(treeId);
      expect(loaded).toBeDefined();
      expect(loaded?.type).toBe(ObjectType.TREE);
    });

    it("stores and loads commit objects", async () => {
      // Minimal commit format
      const commitContent = new TextEncoder().encode(
        `tree ${"0".repeat(40)}
author Test <test@example.com> 1234567890 +0000
committer Test <test@example.com> 1234567890 +0000

Initial commit
`,
      );

      const id = await access.store(ObjectType.COMMIT, commitContent);

      const loaded = await access.load(id);
      expect(loaded).toBeDefined();
      expect(loaded?.type).toBe(ObjectType.COMMIT);
    });
  });

  describe("has", () => {
    it("returns true for existing objects", async () => {
      const content = new TextEncoder().encode("Test content");
      const id = await access.store(ObjectType.BLOB, content);

      expect(await access.has(id)).toBe(true);
    });

    it("returns false for non-existing objects", async () => {
      const fakeId = "a".repeat(40);
      expect(await access.has(fakeId)).toBe(false);
    });
  });

  describe("getInfo", () => {
    it("returns object info for existing objects", async () => {
      const content = new TextEncoder().encode("Test content for info");
      const id = await access.store(ObjectType.BLOB, content);

      const info = await access.getInfo(id);

      expect(info).toBeDefined();
      expect(info?.id).toBe(id);
      expect(info?.type).toBe(ObjectType.BLOB);
      expect(info?.size).toBe(content.length);
    });

    it("returns null for non-existing objects", async () => {
      const fakeId = "b".repeat(40);
      const info = await access.getInfo(fakeId);

      expect(info).toBeNull();
    });
  });

  describe("loadWireFormat", () => {
    it("loads raw wire format data", async () => {
      const content = new TextEncoder().encode("Wire format test");
      const id = await access.store(ObjectType.BLOB, content);

      const wireData = await access.loadWireFormat(id);

      expect(wireData).toBeDefined();
      expect(wireData?.length).toBeGreaterThan(content.length); // Includes header

      // Should start with "blob <size>\0"
      const headerEnd = wireData?.indexOf(0) ?? -1;
      const header = new TextDecoder().decode(wireData?.slice(0, headerEnd));
      expect(header).toMatch(/^blob \d+$/);
    });

    it("returns null for non-existing objects", async () => {
      const fakeId = "c".repeat(40);
      const wireData = await access.loadWireFormat(fakeId);

      expect(wireData).toBeNull();
    });
  });

  describe("enumerate", () => {
    it("enumerates all stored objects", async () => {
      const ids: ObjectId[] = [];

      // Store multiple objects
      for (let i = 0; i < 5; i++) {
        const content = new TextEncoder().encode(`Content ${i}`);
        const id = await access.store(ObjectType.BLOB, content);
        ids.push(id);
      }

      // Enumerate and collect
      const enumerated: ObjectId[] = [];
      for await (const id of access.enumerate()) {
        enumerated.push(id);
      }

      expect(enumerated.length).toBe(5);
      for (const id of ids) {
        expect(enumerated).toContain(id);
      }
    });
  });

  describe("enumerateWithInfo", () => {
    it("enumerates objects with their info", async () => {
      // Store objects of different types
      const blobContent = new TextEncoder().encode("Blob content");
      const blobId = await access.store(ObjectType.BLOB, blobContent);

      // Enumerate with info
      const infos: Array<{ id: ObjectId; type: number; size: number }> = [];
      for await (const info of access.enumerateWithInfo()) {
        infos.push(info);
      }

      expect(infos.length).toBeGreaterThanOrEqual(1);

      const blobInfo = infos.find((i) => i.id === blobId);
      expect(blobInfo).toBeDefined();
      expect(blobInfo?.type).toBe(ObjectType.BLOB);
      expect(blobInfo?.size).toBe(blobContent.length);
    });
  });
});

// Helper function to convert hex string to bytes
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
