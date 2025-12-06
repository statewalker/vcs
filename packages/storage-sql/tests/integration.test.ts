/**
 * Integration tests for SQL storage
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqlJsAdapter } from "../src/adapters/sql-js-adapter.js";
import { createSQLStorage, type SQLStorage } from "../src/create-sql-storage.js";

describe("SQL Storage Integration", () => {
  let sqlStorage: SQLStorage;

  beforeEach(async () => {
    const db = await SqlJsAdapter.create();
    sqlStorage = await createSQLStorage(db);
  });

  afterEach(async () => {
    await sqlStorage.close();
  });

  describe("Basic Storage Operations", () => {
    it("stores and retrieves content", async () => {
      const content = new TextEncoder().encode("Hello, World!");

      async function* chunks() {
        yield content;
      }

      const info = await sqlStorage.storage.store(chunks());
      expect(info).toBeDefined();
      expect(info.id).toBeDefined();
      expect(info.id.length).toBeGreaterThan(0);
      expect(info.size).toBe(content.length);

      // Retrieve
      const retrievedChunks: Uint8Array[] = [];
      for await (const chunk of sqlStorage.storage.load(info.id)) {
        retrievedChunks.push(chunk);
      }

      expect(retrievedChunks).toHaveLength(1);
      expect(retrievedChunks[0]).toEqual(content);
    });

    it("detects duplicate content", async () => {
      const content = new TextEncoder().encode("Duplicate content");

      async function* chunks() {
        yield content;
      }

      const info1 = await sqlStorage.storage.store(chunks());
      const info2 = await sqlStorage.storage.store(chunks());

      expect(info1.id).toBe(info2.id);
      expect(info1.size).toBe(info2.size);
    });

    it("checks if content exists via getInfo", async () => {
      const content = new TextEncoder().encode("Check exists");

      async function* chunks() {
        yield content;
      }

      const { id } = await sqlStorage.storage.store(chunks());

      expect(await sqlStorage.storage.getInfo(id)).not.toBeNull();
      expect(await sqlStorage.storage.getInfo("nonexistent")).toBeNull();
    });

    it("deletes content", async () => {
      const content = new TextEncoder().encode("Delete me");

      async function* chunks() {
        yield content;
      }

      const { id } = await sqlStorage.storage.store(chunks());
      expect(await sqlStorage.storage.getInfo(id)).not.toBeNull();

      await sqlStorage.storage.delete(id);
      expect(await sqlStorage.storage.getInfo(id)).toBeNull();
    });
  });

  describe("Multiple Objects", () => {
    it("stores multiple objects", async () => {
      const ids: string[] = [];

      for (let i = 0; i < 10; i++) {
        const content = new TextEncoder().encode(`Object ${i}`);
        async function* chunks() {
          yield content;
        }
        const { id } = await sqlStorage.storage.store(chunks());
        ids.push(id);
      }

      expect(ids.length).toBe(10);
      expect(new Set(ids).size).toBe(10); // All unique

      // Verify all exist
      for (const id of ids) {
        expect(await sqlStorage.storage.getInfo(id)).not.toBeNull();
      }
    });

    it("lists all objects with info", async () => {
      const storedInfos: Array<{ id: string; size: number }> = [];

      for (let i = 0; i < 5; i++) {
        const content = new TextEncoder().encode(`List object ${i}`);
        async function* chunks() {
          yield content;
        }
        const info = await sqlStorage.storage.store(chunks());
        storedInfos.push(info);
      }

      const listed: Array<{ id: string; size: number }> = [];
      for await (const info of sqlStorage.storage.listObjects()) {
        listed.push(info);
      }

      expect(listed.length).toBe(5);
      for (const info of storedInfos) {
        const found = listed.find((l) => l.id === info.id);
        expect(found).toBeDefined();
        expect(found?.size).toBe(info.size);
      }
    });
  });

  describe("Binary Content", () => {
    it("handles binary data", async () => {
      const content = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        content[i] = i;
      }

      async function* chunks() {
        yield content;
      }

      const { id } = await sqlStorage.storage.store(chunks());

      const retrievedChunks: Uint8Array[] = [];
      for await (const chunk of sqlStorage.storage.load(id)) {
        retrievedChunks.push(chunk);
      }

      expect(retrievedChunks[0]).toEqual(content);
    });

    it("handles large content", async () => {
      // 100KB of random-ish data
      const content = new Uint8Array(100 * 1024);
      for (let i = 0; i < content.length; i++) {
        content[i] = (i * 17 + 31) % 256;
      }

      async function* chunks() {
        yield content;
      }

      const { id, size } = await sqlStorage.storage.store(chunks());
      expect(size).toBe(content.length);

      const retrievedChunks: Uint8Array[] = [];
      for await (const chunk of sqlStorage.storage.load(id)) {
        retrievedChunks.push(chunk);
      }

      expect(retrievedChunks[0].length).toBe(content.length);
      expect(retrievedChunks[0]).toEqual(content);
    });
  });

  describe("Database Persistence", () => {
    it("can export and restore database", async () => {
      // Store some content
      const content = new TextEncoder().encode("Persistent content");
      async function* chunks() {
        yield content;
      }
      const { id } = await sqlStorage.storage.store(chunks());

      // Export database
      const db = sqlStorage.db as SqlJsAdapter;
      const exported = db.export();

      // Create new storage from exported data
      const db2 = await SqlJsAdapter.open(exported);
      const sqlStorage2 = await createSQLStorage(db2, { autoMigrate: false });

      // Verify content exists
      expect(await sqlStorage2.storage.getInfo(id)).not.toBeNull();

      const retrievedChunks: Uint8Array[] = [];
      for await (const chunk of sqlStorage2.storage.load(id)) {
        retrievedChunks.push(chunk);
      }
      expect(retrievedChunks[0]).toEqual(content);

      await sqlStorage2.close();
    });
  });

  describe("Configuration Options", () => {
    it("respects hashAlgorithm option", async () => {
      // Create storage with SHA-1
      const db = await SqlJsAdapter.create();
      const sha1Storage = await createSQLStorage(db, { hashAlgorithm: "SHA-1" });

      const content = new TextEncoder().encode("SHA-1 test");
      async function* chunks() {
        yield content;
      }
      const { id } = await sha1Storage.storage.store(chunks());

      // SHA-1 produces 40 character hex strings
      expect(id.length).toBe(40);

      await sha1Storage.close();
    });

    it("respects autoMigrate option", async () => {
      // Create storage without auto-migrate on empty database
      const db = await SqlJsAdapter.create();
      const storage = await createSQLStorage(db, { autoMigrate: false });

      // Should fail when trying to use storage because schema doesn't exist
      const content = new TextEncoder().encode("test");
      async function* chunks() {
        yield content;
      }

      await expect(storage.storage.store(chunks())).rejects.toThrow();

      await storage.close();
    });
  });
});
