/**
 * SQLStorageBackend tests
 *
 * Tests the SQL storage backend and factory registration.
 */

import type { ObjectId } from "@statewalker/vcs-core";
import { createHistory, hasHistoryBackendFactory } from "@statewalker/vcs-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqlJsAdapter } from "../src/adapters/sql-js-adapter.js";
import { registerSqlHistoryFactory } from "../src/register-backend.js";
import { SQLStorageBackend } from "../src/sql-storage-backend.js";

describe("registerSqlHistoryFactory", () => {
  it("registers the SQL backend with the factory", async () => {
    registerSqlHistoryFactory();
    expect(hasHistoryBackendFactory("sql")).toBe(true);

    const db = await SqlJsAdapter.create();
    const history = await createHistory("sql", { db });

    await history.initialize();
    // Verify we can use the history
    expect(history.commits).toBeDefined();
    expect(history.blobs).toBeDefined();
    await history.close();
  });

  it("throws without db client", async () => {
    registerSqlHistoryFactory();
    await expect(createHistory("sql", {})).rejects.toThrow("requires a database client");
  });
});

describe("SQLStorageBackend", () => {
  let backend: SQLStorageBackend;

  beforeEach(async () => {
    const db = await SqlJsAdapter.create();
    backend = new SQLStorageBackend({ db });
    await backend.initialize();
  });

  afterEach(async () => {
    if (backend?.isInitialized()) {
      await backend.close();
    }
  });

  describe("capabilities", () => {
    it("reports correct capabilities", () => {
      expect(backend.capabilities.nativeBlobDeltas).toBe(true);
      expect(backend.capabilities.randomAccess).toBe(true);
      expect(backend.capabilities.atomicBatch).toBe(true);
      expect(backend.capabilities.nativeGitFormat).toBe(false);
    });
  });

  describe("stores", () => {
    describe("blobs", () => {
      it("stores and loads blob content", async () => {
        const content = new TextEncoder().encode("Hello, World!");

        async function* chunks() {
          yield content;
        }

        const id = await backend.blobs.store(chunks());
        expect(id).toBeTruthy();

        const loaded: Uint8Array[] = [];
        const stream = await backend.blobs.load(id);
        if (!stream) throw new Error("Blob not found");
        for await (const chunk of stream) {
          loaded.push(chunk);
        }

        const result = new Uint8Array(loaded.reduce((acc, c) => acc + c.length, 0));
        let offset = 0;
        for (const chunk of loaded) {
          result.set(chunk, offset);
          offset += chunk.length;
        }

        expect(new TextDecoder().decode(result)).toBe("Hello, World!");
      });

      it("checks blob existence", async () => {
        const content = new TextEncoder().encode("Test content");

        async function* chunks() {
          yield content;
        }

        const id = await backend.blobs.store(chunks());

        expect(await backend.blobs.has(id)).toBe(true);
        expect(await backend.blobs.has("0000000000000000000000000000000000000000")).toBe(false);
      });

      it("returns blob size", async () => {
        const content = new TextEncoder().encode("Hello, World!");

        async function* chunks() {
          yield content;
        }

        const id = await backend.blobs.store(chunks());

        expect(await backend.blobs.size(id)).toBe(13);
      });

      it("lists blob keys", async () => {
        const content1 = new TextEncoder().encode("Content 1");
        const content2 = new TextEncoder().encode("Content 2");

        async function* chunks1() {
          yield content1;
        }
        async function* chunks2() {
          yield content2;
        }

        const id1 = await backend.blobs.store(chunks1());
        const id2 = await backend.blobs.store(chunks2());

        const keys: ObjectId[] = [];
        for await (const key of backend.blobs.keys()) {
          keys.push(key);
        }

        expect(keys).toContain(id1);
        expect(keys).toContain(id2);
      });

      it("deletes blobs", async () => {
        const content = new TextEncoder().encode("To be deleted");

        async function* chunks() {
          yield content;
        }

        const id = await backend.blobs.store(chunks());
        expect(await backend.blobs.has(id)).toBe(true);

        const deleted = await backend.blobs.remove(id);
        expect(deleted).toBe(true);
        expect(await backend.blobs.has(id)).toBe(false);
      });
    });

    describe("trees", () => {
      it("stores and loads tree entries", async () => {
        const blobContent = new TextEncoder().encode("file content");

        async function* blobChunks() {
          yield blobContent;
        }

        const blobId = await backend.blobs.store(blobChunks());

        const entries = [{ mode: 0o100644, name: "file.txt", id: blobId }];

        const treeId = await backend.trees.store(entries);
        expect(treeId).toBeTruthy();

        const loaded = [];
        const treeEntries = await backend.trees.load(treeId);
        if (!treeEntries) throw new Error("Tree not found");
        for await (const entry of treeEntries) {
          loaded.push(entry);
        }

        expect(loaded).toHaveLength(1);
        expect(loaded[0].name).toBe("file.txt");
        expect(loaded[0].id).toBe(blobId);
      });

      it("returns empty tree ID", () => {
        const emptyTreeId = backend.trees.getEmptyTreeId();
        expect(emptyTreeId).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
      });
    });

    describe("commits", () => {
      it("stores and loads commits", async () => {
        const emptyTreeId = backend.trees.getEmptyTreeId();

        const commit = {
          tree: emptyTreeId,
          parents: [],
          author: {
            name: "Test Author",
            email: "test@example.com",
            timestamp: 1700000000,
            tzOffset: "+0000",
          },
          committer: {
            name: "Test Committer",
            email: "committer@example.com",
            timestamp: 1700000001,
            tzOffset: "+0000",
          },
          message: "Initial commit",
        };

        const commitId = await backend.commits.store(commit);
        expect(commitId).toBeTruthy();

        const loaded = await backend.commits.load(commitId);
        expect(loaded.tree).toBe(emptyTreeId);
        expect(loaded.message).toBe("Initial commit");
        expect(loaded.author.name).toBe("Test Author");
      });

      it("returns parent commits", async () => {
        const emptyTreeId = backend.trees.getEmptyTreeId();

        const commit1 = {
          tree: emptyTreeId,
          parents: [],
          author: {
            name: "Author",
            email: "a@example.com",
            timestamp: 1700000000,
            tzOffset: "+0000",
          },
          committer: {
            name: "Author",
            email: "a@example.com",
            timestamp: 1700000000,
            tzOffset: "+0000",
          },
          message: "First commit",
        };

        const commitId1 = await backend.commits.store(commit1);

        const commit2 = {
          tree: emptyTreeId,
          parents: [commitId1],
          author: {
            name: "Author",
            email: "a@example.com",
            timestamp: 1700000001,
            tzOffset: "+0000",
          },
          committer: {
            name: "Author",
            email: "a@example.com",
            timestamp: 1700000001,
            tzOffset: "+0000",
          },
          message: "Second commit",
        };

        const commitId2 = await backend.commits.store(commit2);

        const parents = await backend.commits.getParents(commitId2);
        expect(parents).toEqual([commitId1]);
      });
    });

    describe("refs", () => {
      it("sets and gets refs", async () => {
        const emptyTreeId = backend.trees.getEmptyTreeId();

        const commit = {
          tree: emptyTreeId,
          parents: [],
          author: {
            name: "Author",
            email: "a@example.com",
            timestamp: 1700000000,
            tzOffset: "+0000",
          },
          committer: {
            name: "Author",
            email: "a@example.com",
            timestamp: 1700000000,
            tzOffset: "+0000",
          },
          message: "Test commit",
        };

        const commitId = await backend.commits.store(commit);

        await backend.refs.set("refs/heads/main", commitId);

        const ref = await backend.refs.get("refs/heads/main");
        expect(ref).toBeDefined();
        expect((ref as { objectId: string }).objectId).toBe(commitId);
      });

      it("sets and resolves symbolic refs", async () => {
        const emptyTreeId = backend.trees.getEmptyTreeId();

        const commit = {
          tree: emptyTreeId,
          parents: [],
          author: {
            name: "Author",
            email: "a@example.com",
            timestamp: 1700000000,
            tzOffset: "+0000",
          },
          committer: {
            name: "Author",
            email: "a@example.com",
            timestamp: 1700000000,
            tzOffset: "+0000",
          },
          message: "Test commit",
        };

        const commitId = await backend.commits.store(commit);

        await backend.refs.set("refs/heads/main", commitId);
        await backend.refs.setSymbolic("HEAD", "refs/heads/main");

        const resolved = await backend.refs.resolve("HEAD");
        expect(resolved).toBeDefined();
        expect(resolved?.objectId).toBe(commitId);
      });
    });
  });

  describe("delta API", () => {
    it("starts and ends batch without error", async () => {
      backend.delta.startBatch();
      await backend.delta.endBatch();
    });

    it("throws when ending batch without starting", async () => {
      await expect(backend.delta.endBatch()).rejects.toThrow("No batch in progress");
    });

    it("allows canceling batch", () => {
      backend.delta.startBatch();
      backend.delta.cancelBatch();
      // Should not throw when called without active batch
      backend.delta.cancelBatch();
    });

    it("tracks blob deltas", async () => {
      const content1 = new TextEncoder().encode("Base content for testing");
      const content2 = new TextEncoder().encode("Base content for testing - modified");

      async function* chunks1() {
        yield content1;
      }
      async function* chunks2() {
        yield content2;
      }

      const baseId = await backend.blobs.store(chunks1());
      const targetId = await backend.blobs.store(chunks2());

      // Initially not a delta
      expect(await backend.delta.isDelta(targetId)).toBe(false);

      // Store as delta
      const deltaBytes = new TextEncoder().encode("mock-delta-data");

      async function* deltaStream() {
        yield deltaBytes;
      }

      await backend.delta.blobs.deltifyBlob(targetId, baseId, deltaStream());

      // Now it should be a delta
      expect(await backend.delta.isDelta(targetId)).toBe(true);

      // Check chain info
      const chain = await backend.delta.getDeltaChain(targetId);
      expect(chain).toBeDefined();
      expect(chain?.depth).toBe(1);
      expect(chain?.baseIds).toContain(baseId);
    });

    it("lists all deltas", async () => {
      const content1 = new TextEncoder().encode("Base");
      const content2 = new TextEncoder().encode("Target");

      async function* chunks1() {
        yield content1;
      }
      async function* chunks2() {
        yield content2;
      }

      const baseId = await backend.blobs.store(chunks1());
      const targetId = await backend.blobs.store(chunks2());

      const deltaBytes = new TextEncoder().encode("delta");

      async function* deltaStream() {
        yield deltaBytes;
      }

      await backend.delta.blobs.deltifyBlob(targetId, baseId, deltaStream());

      const deltas = [];
      for await (const delta of backend.delta.listDeltas()) {
        deltas.push(delta);
      }

      expect(deltas.length).toBeGreaterThan(0);
      expect(deltas.some((d) => d.targetId === targetId)).toBe(true);
    });

    it("gets dependents of a base", async () => {
      const content1 = new TextEncoder().encode("Base content");
      const content2 = new TextEncoder().encode("Dependent 1");
      const content3 = new TextEncoder().encode("Dependent 2");

      async function* chunks1() {
        yield content1;
      }
      async function* chunks2() {
        yield content2;
      }
      async function* chunks3() {
        yield content3;
      }

      const baseId = await backend.blobs.store(chunks1());
      const targetId1 = await backend.blobs.store(chunks2());
      const targetId2 = await backend.blobs.store(chunks3());

      const deltaBytes = new TextEncoder().encode("delta");

      async function* deltaStream1() {
        yield deltaBytes;
      }
      async function* deltaStream2() {
        yield deltaBytes;
      }

      await backend.delta.blobs.deltifyBlob(targetId1, baseId, deltaStream1());
      await backend.delta.blobs.deltifyBlob(targetId2, baseId, deltaStream2());

      const dependents = [];
      for await (const dep of backend.delta.getDependents(baseId)) {
        dependents.push(dep);
      }

      expect(dependents).toContain(targetId1);
      expect(dependents).toContain(targetId2);
    });

    it("undeltifies blob", async () => {
      const content1 = new TextEncoder().encode("Base");
      const content2 = new TextEncoder().encode("Target");

      async function* chunks1() {
        yield content1;
      }
      async function* chunks2() {
        yield content2;
      }

      const baseId = await backend.blobs.store(chunks1());
      const targetId = await backend.blobs.store(chunks2());

      const deltaBytes = new TextEncoder().encode("delta");

      async function* deltaStream() {
        yield deltaBytes;
      }

      await backend.delta.blobs.deltifyBlob(targetId, baseId, deltaStream());
      expect(await backend.delta.isDelta(targetId)).toBe(true);

      await backend.delta.blobs.undeltifyBlob(targetId);
      expect(await backend.delta.isDelta(targetId)).toBe(false);
    });
  });

  describe("lifecycle", () => {
    it("initializes only once", async () => {
      // Already initialized in beforeEach
      expect(backend.isInitialized()).toBe(true);

      // Call initialize again - should be idempotent
      await backend.initialize();
      expect(backend.isInitialized()).toBe(true);
    });

    it("closes cleanly", async () => {
      expect(backend.isInitialized()).toBe(true);
      await backend.close();
      expect(backend.isInitialized()).toBe(false);
    });

    it("provides access to database", () => {
      const db = backend.getDatabase();
      expect(db).toBeDefined();
      expect(typeof db.query).toBe("function");
      expect(typeof db.execute).toBe("function");
    });
  });
});
