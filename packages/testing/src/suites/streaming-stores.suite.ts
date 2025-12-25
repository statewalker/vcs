/**
 * Parametrized test suite for GitStores (streaming stores) implementations
 *
 * Tests the streaming stores architecture across different backends
 * to verify Git-compatible object ID generation.
 */

import type { GitStores } from "@webrun-vcs/core";
import { ObjectType } from "@webrun-vcs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Context provided by the stores factory
 */
export interface StreamingStoresTestContext {
  stores: GitStores;
  cleanup?: () => Promise<void>;
}

/**
 * Factory function to create stores instance for testing
 */
export type StreamingStoresFactory = () => Promise<StreamingStoresTestContext>;

/**
 * Helper to collect async iterable of Uint8Array
 */
async function collectBytes(input: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for await (const chunk of input) {
    chunks.push(chunk);
    totalLength += chunk.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Helper to collect async iterable to array
 */
async function toArray<T>(input: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of input) {
    result.push(item);
  }
  return result;
}

/**
 * Helper to create async iterable from Uint8Array
 */
async function* toStream(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Create the GitStores test suite with a specific factory
 */
export function createStreamingStoresTests(name: string, factory: StreamingStoresFactory): void {
  describe(`StreamingStores [${name}]`, () => {
    let ctx: StreamingStoresTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup?.();
    });

    describe("Blob Store", () => {
      it("stores and loads blob", async () => {
        const content = encoder.encode("Hello, World!");
        const id = await ctx.stores.blobs.store(toStream(content));

        expect(id).toMatch(/^[0-9a-f]{40}$/);

        const loaded = await collectBytes(ctx.stores.blobs.load(id));
        expect(decoder.decode(loaded)).toBe("Hello, World!");
      });

      it("stores blob with known size", async () => {
        const content = encoder.encode("Test content");
        const id = await ctx.stores.blobs.store(toStream(content));

        expect(id).toMatch(/^[0-9a-f]{40}$/);
        expect(await ctx.stores.blobs.has(id)).toBe(true);
      });

      it("produces consistent IDs for same content", async () => {
        const content = encoder.encode("Same content");

        const id1 = await ctx.stores.blobs.store(toStream(content));
        const id2 = await ctx.stores.blobs.store(toStream(content));

        expect(id1).toBe(id2);
      });
    });

    describe("Tree Store", () => {
      it("stores and loads tree", async () => {
        // First create a blob
        const blobContent = encoder.encode("file content");
        const blobId = await ctx.stores.blobs.store(toStream(blobContent));

        // Store tree with entry
        const treeId = await ctx.stores.trees.storeTree([
          { mode: 0o100644, name: "test.txt", id: blobId },
        ]);

        expect(treeId).toMatch(/^[0-9a-f]{40}$/);

        // Load and verify
        const entries = await toArray(ctx.stores.trees.loadTree(treeId));
        expect(entries).toHaveLength(1);
        expect(entries[0].name).toBe("test.txt");
        expect(entries[0].mode).toBe(0o100644);
        expect(entries[0].id).toBe(blobId);
      });

      it("sorts entries correctly", async () => {
        const blobId = await ctx.stores.blobs.store(toStream(encoder.encode("x")));

        // Store tree with entries in wrong order
        const treeId = await ctx.stores.trees.storeTree([
          { mode: 0o100644, name: "z.txt", id: blobId },
          { mode: 0o100644, name: "a.txt", id: blobId },
        ]);

        const entries = await toArray(ctx.stores.trees.loadTree(treeId));
        expect(entries[0].name).toBe("a.txt");
        expect(entries[1].name).toBe("z.txt");
      });
    });

    describe("Commit Store", () => {
      it("stores and loads commit", async () => {
        // Create a tree
        const blobId = await ctx.stores.blobs.store(toStream(encoder.encode("content")));
        const treeId = await ctx.stores.trees.storeTree([
          { mode: 0o100644, name: "file.txt", id: blobId },
        ]);

        // Store commit
        const commitId = await ctx.stores.commits.storeCommit({
          tree: treeId,
          parents: [],
          author: {
            name: "Test",
            email: "test@example.com",
            timestamp: 1000000000,
            tzOffset: "+0000",
          },
          committer: {
            name: "Test",
            email: "test@example.com",
            timestamp: 1000000000,
            tzOffset: "+0000",
          },
          message: "Initial commit",
        });

        expect(commitId).toMatch(/^[0-9a-f]{40}$/);

        // Load and verify
        const commit = await ctx.stores.commits.loadCommit(commitId);
        expect(commit.tree).toBe(treeId);
        expect(commit.message).toBe("Initial commit");
        expect(commit.author.name).toBe("Test");
      });

      it("stores commit with parent", async () => {
        // Create first commit
        const blobId = await ctx.stores.blobs.store(toStream(encoder.encode("v1")));
        const treeId1 = await ctx.stores.trees.storeTree([
          { mode: 0o100644, name: "file.txt", id: blobId },
        ]);
        const parentId = await ctx.stores.commits.storeCommit({
          tree: treeId1,
          parents: [],
          author: {
            name: "Test",
            email: "test@example.com",
            timestamp: 1000000000,
            tzOffset: "+0000",
          },
          committer: {
            name: "Test",
            email: "test@example.com",
            timestamp: 1000000000,
            tzOffset: "+0000",
          },
          message: "First commit",
        });

        // Create second commit with parent
        const blobId2 = await ctx.stores.blobs.store(toStream(encoder.encode("v2")));
        const treeId2 = await ctx.stores.trees.storeTree([
          { mode: 0o100644, name: "file.txt", id: blobId2 },
        ]);
        const commitId = await ctx.stores.commits.storeCommit({
          tree: treeId2,
          parents: [parentId],
          author: {
            name: "Test",
            email: "test@example.com",
            timestamp: 1000000001,
            tzOffset: "+0000",
          },
          committer: {
            name: "Test",
            email: "test@example.com",
            timestamp: 1000000001,
            tzOffset: "+0000",
          },
          message: "Second commit",
        });

        const commit = await ctx.stores.commits.loadCommit(commitId);
        expect(commit.parents).toEqual([parentId]);
      });
    });

    describe("Tag Store", () => {
      it("stores and loads tag", async () => {
        // Create a commit to tag
        const blobId = await ctx.stores.blobs.store(toStream(encoder.encode("content")));
        const treeId = await ctx.stores.trees.storeTree([
          { mode: 0o100644, name: "file.txt", id: blobId },
        ]);
        const commitId = await ctx.stores.commits.storeCommit({
          tree: treeId,
          parents: [],
          author: {
            name: "Test",
            email: "test@example.com",
            timestamp: 1000000000,
            tzOffset: "+0000",
          },
          committer: {
            name: "Test",
            email: "test@example.com",
            timestamp: 1000000000,
            tzOffset: "+0000",
          },
          message: "Initial",
        });

        // Store tag
        const tagId = await ctx.stores.tags.storeTag({
          object: commitId,
          objectType: ObjectType.COMMIT,
          tag: "v1.0.0",
          tagger: {
            name: "Test",
            email: "test@example.com",
            timestamp: 1000000000,
            tzOffset: "+0000",
          },
          message: "Version 1.0.0",
        });

        expect(tagId).toMatch(/^[0-9a-f]{40}$/);

        // Load and verify
        const tag = await ctx.stores.tags.loadTag(tagId);
        expect(tag.object).toBe(commitId);
        expect(tag.objectType).toBe(ObjectType.COMMIT);
        expect(tag.tag).toBe("v1.0.0");
        expect(tag.message).toBe("Version 1.0.0");
      });
    });

    describe("Git Compatibility", () => {
      it("produces Git-compatible blob ID", async () => {
        // Known Git hash for "Hello, World!" as blob:
        // echo -n "Hello, World!" | git hash-object --stdin
        // b45ef6fec89518d314f546fd6c3025367b721684
        const content = encoder.encode("Hello, World!");
        const id = await ctx.stores.blobs.store(toStream(content));

        expect(id).toBe("b45ef6fec89518d314f546fd6c3025367b721684");
      });

      it("produces consistent IDs across store/load cycles", async () => {
        const content = encoder.encode("Test");
        const id1 = await ctx.stores.blobs.store(toStream(content));

        // Load and re-store should produce same ID
        const loaded = await collectBytes(ctx.stores.blobs.load(id1));
        const id2 = await ctx.stores.blobs.store(toStream(loaded));

        expect(id1).toBe(id2);
      });
    });
  });
}

/**
 * Cross-backend roundtrip test
 *
 * Verifies that objects can be transferred between backends
 * with identical IDs.
 */
export function createCrossBackendTests(
  backends: Array<{ name: string; factory: StreamingStoresFactory }>,
): void {
  describe("Cross-backend roundtrip", () => {
    for (const from of backends) {
      for (const to of backends) {
        if (from.name === to.name) continue;

        it(`roundtrips blob from ${from.name} to ${to.name}`, async () => {
          const fromCtx = await from.factory();
          const toCtx = await to.factory();

          try {
            const content = encoder.encode(`Content from ${from.name} to ${to.name}`);
            const fromId = await fromCtx.stores.blobs.store(toStream(content));

            // Load from source and store in target
            const loaded = fromCtx.stores.blobs.load(fromId);
            const toId = await toCtx.stores.blobs.store(loaded);

            // IDs should match
            expect(toId).toBe(fromId);

            // Content should match
            const roundtripped = await collectBytes(toCtx.stores.blobs.load(toId));
            expect(decoder.decode(roundtripped)).toBe(`Content from ${from.name} to ${to.name}`);
          } finally {
            await fromCtx.cleanup?.();
            await toCtx.cleanup?.();
          }
        });

        it(`roundtrips tree from ${from.name} to ${to.name}`, async () => {
          const fromCtx = await from.factory();
          const toCtx = await to.factory();

          try {
            // Create blob and tree in source
            const blobId = await fromCtx.stores.blobs.store(
              toStream(encoder.encode("file content")),
            );
            const fromTreeId = await fromCtx.stores.trees.storeTree([
              { mode: 0o100644, name: "test.txt", id: blobId },
            ]);

            // Re-create in target (trees need to be serialized/deserialized)
            // First transfer the blob
            const blobContent = fromCtx.stores.blobs.load(blobId);
            const toBlobId = await toCtx.stores.blobs.store(blobContent);
            expect(toBlobId).toBe(blobId);

            // Then create the same tree
            const toTreeId = await toCtx.stores.trees.storeTree([
              { mode: 0o100644, name: "test.txt", id: toBlobId },
            ]);

            // Tree IDs should match
            expect(toTreeId).toBe(fromTreeId);
          } finally {
            await fromCtx.cleanup?.();
            await toCtx.cleanup?.();
          }
        });
      }
    }
  });
}
