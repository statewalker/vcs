/**
 * Cross-backend integration tests
 *
 * Verifies that all storage backends produce identical Git object IDs
 * and can interoperate by transferring objects between backends.
 *
 * Tests use the new object-storage factory functions that are the recommended
 * approach for the new architecture.
 */

import { createKvObjectStores, MemoryKVAdapter } from "@statewalker/vcs-store-kv";
import { createMemoryObjectStores } from "@statewalker/vcs-store-mem";
import { createSqlObjectStores } from "@statewalker/vcs-store-sql";
import { SqlJsAdapter } from "@statewalker/vcs-store-sql/adapters/sql-js";
import {
  createCrossBackendTests,
  createGitCompatibilityTests,
  createStreamingStoresTests,
  type StreamingStoresFactory,
} from "@statewalker/vcs-testing";
import { describe, expect, it } from "vitest";

// Factory for memory backend using new object-storage API
const memoryFactory: StreamingStoresFactory = async () => {
  const stores = createMemoryObjectStores();
  return { stores };
};

// Factory for KV backend using new object-storage API
const kvFactory: StreamingStoresFactory = async () => {
  const kv = new MemoryKVAdapter();
  const stores = createKvObjectStores({ kv });
  return { stores };
};

// Factory for SQL backend using new object-storage API
const sqlFactory: StreamingStoresFactory = async () => {
  const db = await SqlJsAdapter.create();
  const stores = createSqlObjectStores({ db });
  return {
    stores,
    cleanup: async () => {
      await db.close();
    },
  };
};

// Define all backends for cross-backend testing
const backends = [
  { name: "Memory", factory: memoryFactory },
  { name: "KV", factory: kvFactory },
  { name: "SQL", factory: sqlFactory },
];

// Run individual backend tests to verify each one works
createStreamingStoresTests("Memory", memoryFactory);
createStreamingStoresTests("KV", kvFactory);
createStreamingStoresTests("SQL", sqlFactory);

// Run Git compatibility tests for each backend
createGitCompatibilityTests("Memory", memoryFactory);
createGitCompatibilityTests("KV", kvFactory);
createGitCompatibilityTests("SQL", sqlFactory);

// Run cross-backend roundtrip tests
createCrossBackendTests(backends);

/**
 * Additional SHA-1 consistency tests
 *
 * Verifies that all backends produce identical SHA-1 hashes for the same content.
 * This is critical for Git compatibility and data portability.
 */
const encoder = new TextEncoder();

async function* toStream(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}

describe("SHA-1 Consistency Across Backends", () => {
  it("all backends produce identical blob IDs for same content", async () => {
    const content = encoder.encode("Test content for SHA-1 verification");
    const ids: string[] = [];

    for (const backend of backends) {
      const ctx = await backend.factory();
      try {
        const id = await ctx.stores.blobs.store(toStream(content));
        ids.push(id);
      } finally {
        await ctx.cleanup?.();
      }
    }

    // All IDs should be identical
    expect(ids.every((id) => id === ids[0])).toBe(true);
    // Verify it's a valid SHA-1 format
    expect(ids[0]).toMatch(/^[0-9a-f]{40}$/);
  });

  it("all backends produce Git-compatible SHA-1 for known content", async () => {
    // Known Git hash: echo -n "hello" | git hash-object --stdin
    // Returns: b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0
    const content = encoder.encode("hello");
    const expectedId = "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0";

    for (const backend of backends) {
      const ctx = await backend.factory();
      try {
        const id = await ctx.stores.blobs.store(toStream(content));
        expect(id).toBe(expectedId);
      } finally {
        await ctx.cleanup?.();
      }
    }
  });

  it("all backends produce identical tree IDs for same entries", async () => {
    const blobContent = encoder.encode("file content");
    const treeIds: string[] = [];

    for (const backend of backends) {
      const ctx = await backend.factory();
      try {
        // Create blob first (same ID for all backends)
        const blobId = await ctx.stores.blobs.store(toStream(blobContent));
        // Create tree with same entry
        const treeId = await ctx.stores.trees.storeTree([
          { mode: 0o100644, name: "test.txt", id: blobId },
        ]);
        treeIds.push(treeId);
      } finally {
        await ctx.cleanup?.();
      }
    }

    // All tree IDs should be identical
    expect(treeIds.every((id) => id === treeIds[0])).toBe(true);
    expect(treeIds[0]).toMatch(/^[0-9a-f]{40}$/);
  });

  it("all backends produce identical commit IDs for same data", async () => {
    const commitData = {
      tree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904", // empty tree
      parents: [] as string[],
      author: {
        name: "Test Author",
        email: "test@example.com",
        timestamp: 1000000000,
        tzOffset: "+0000",
      },
      committer: {
        name: "Test Author",
        email: "test@example.com",
        timestamp: 1000000000,
        tzOffset: "+0000",
      },
      message: "Test commit",
    };

    const commitIds: string[] = [];

    for (const backend of backends) {
      const ctx = await backend.factory();
      try {
        const commitId = await ctx.stores.commits.storeCommit(commitData);
        commitIds.push(commitId);
      } finally {
        await ctx.cleanup?.();
      }
    }

    // All commit IDs should be identical
    expect(commitIds.every((id) => id === commitIds[0])).toBe(true);
    expect(commitIds[0]).toMatch(/^[0-9a-f]{40}$/);
  });
});
