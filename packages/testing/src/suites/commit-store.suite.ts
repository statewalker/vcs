/**
 * Parametrized test suite for CommitStore implementations
 *
 * This suite tests the core CommitStore interface contract.
 * All storage implementations must pass these tests.
 */

import type { Commit, CommitStore, PersonIdent } from "@statewalker/vcs-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Context provided by the storage factory
 */
export interface CommitStoreTestContext {
  commitStore: CommitStore;
  cleanup?: () => Promise<void>;
}

/**
 * Factory function to create a storage instance for testing
 */
export type CommitStoreFactory = () => Promise<CommitStoreTestContext>;

/**
 * Helper function to generate a fake object ID (for testing)
 */
function fakeObjectId(seed: string): string {
  return seed.padEnd(40, "0").slice(0, 40);
}

/**
 * Helper function to create a test person identity
 */
function createPerson(name: string, timestamp: number): PersonIdent {
  return {
    name,
    email: `${name.toLowerCase().replace(/\s/g, ".")}@example.com`,
    timestamp,
    tzOffset: "+0000",
  };
}

/**
 * Helper function to create a test commit
 */
function createCommit(options: {
  tree?: string;
  parents?: string[];
  message: string;
  timestamp?: number;
}): Commit {
  const timestamp = options.timestamp ?? Date.now();
  return {
    tree: options.tree ?? fakeObjectId("tree"),
    parents: options.parents ?? [],
    author: createPerson("Test Author", timestamp),
    committer: createPerson("Test Committer", timestamp),
    message: options.message,
  };
}

/**
 * Helper function to collect commit IDs from ancestry walk
 */
async function collectAncestry(iterable: AsyncIterable<string>): Promise<string[]> {
  const ids: string[] = [];
  for await (const id of iterable) {
    ids.push(id);
  }
  return ids;
}

/**
 * Create the CommitStore test suite with a specific factory
 *
 * @param name Name of the storage implementation (e.g., "Memory", "SQL", "KV")
 * @param factory Factory function to create storage instances
 */
export function createCommitStoreTests(name: string, factory: CommitStoreFactory): void {
  describe(`CommitStore [${name}]`, () => {
    let ctx: CommitStoreTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup?.();
    });

    describe("Basic Operations", () => {
      it("stores and retrieves commits", async () => {
        const commit = createCommit({ message: "Initial commit" });
        const id = await ctx.commitStore.storeCommit(commit);

        expect(id).toBeDefined();
        expect(typeof id).toBe("string");

        const loaded = await ctx.commitStore.loadCommit(id);
        expect(loaded.message).toBe("Initial commit");
        expect(loaded.tree).toBe(commit.tree);
      });

      it("returns consistent IDs for same commit", async () => {
        const commit = createCommit({ message: "Test", timestamp: 1000000 });

        const id1 = await ctx.commitStore.storeCommit(commit);
        const id2 = await ctx.commitStore.storeCommit(commit);
        expect(id1).toBe(id2);
      });

      it("returns different IDs for different commits", async () => {
        const commit1 = createCommit({ message: "Commit 1", timestamp: 1000000 });
        const commit2 = createCommit({ message: "Commit 2", timestamp: 1000001 });

        const id1 = await ctx.commitStore.storeCommit(commit1);
        const id2 = await ctx.commitStore.storeCommit(commit2);
        expect(id1).not.toBe(id2);
      });

      it("checks existence via hasCommit", async () => {
        const commit = createCommit({ message: "Test" });
        const id = await ctx.commitStore.storeCommit(commit);

        expect(await ctx.commitStore.hasCommit(id)).toBe(true);
        expect(await ctx.commitStore.hasCommit("nonexistent-commit-id-00000000")).toBe(false);
      });
    });

    describe("Commit Properties", () => {
      it("preserves tree reference", async () => {
        const treeId = fakeObjectId("mytree");
        const commit = createCommit({ tree: treeId, message: "Test" });
        const id = await ctx.commitStore.storeCommit(commit);

        const tree = await ctx.commitStore.getTree(id);
        expect(tree).toBe(treeId);
      });

      it("preserves author information", async () => {
        const commit = createCommit({ message: "Test" });
        commit.author = {
          name: "Jane Doe",
          email: "jane@example.com",
          timestamp: 1234567890,
          tzOffset: "-0500",
        };

        const id = await ctx.commitStore.storeCommit(commit);
        const loaded = await ctx.commitStore.loadCommit(id);

        expect(loaded.author.name).toBe("Jane Doe");
        expect(loaded.author.email).toBe("jane@example.com");
        expect(loaded.author.timestamp).toBe(1234567890);
        expect(loaded.author.tzOffset).toBe("-0500");
      });

      it("preserves committer information", async () => {
        const commit = createCommit({ message: "Test" });
        commit.committer = {
          name: "John Smith",
          email: "john@example.com",
          timestamp: 1234567891,
          tzOffset: "+0530",
        };

        const id = await ctx.commitStore.storeCommit(commit);
        const loaded = await ctx.commitStore.loadCommit(id);

        expect(loaded.committer.name).toBe("John Smith");
        expect(loaded.committer.email).toBe("john@example.com");
        expect(loaded.committer.timestamp).toBe(1234567891);
        expect(loaded.committer.tzOffset).toBe("+0530");
      });

      it("preserves multi-line commit messages", async () => {
        const message = "First line\n\nSecond paragraph.\n\n- bullet 1\n- bullet 2";
        const commit = createCommit({ message });
        const id = await ctx.commitStore.storeCommit(commit);

        const loaded = await ctx.commitStore.loadCommit(id);
        expect(loaded.message).toBe(message);
      });
    });

    describe("Parent Relationships", () => {
      it("handles root commit (no parents)", async () => {
        const commit = createCommit({ parents: [], message: "Root" });
        const id = await ctx.commitStore.storeCommit(commit);

        const parents = await ctx.commitStore.getParents(id);
        expect(parents).toHaveLength(0);
      });

      it("handles single parent", async () => {
        const parent = createCommit({ message: "Parent", timestamp: 1000 });
        const parentId = await ctx.commitStore.storeCommit(parent);

        const child = createCommit({ parents: [parentId], message: "Child", timestamp: 2000 });
        const childId = await ctx.commitStore.storeCommit(child);

        const parents = await ctx.commitStore.getParents(childId);
        expect(parents).toHaveLength(1);
        expect(parents[0]).toBe(parentId);
      });

      it("handles merge commit (multiple parents)", async () => {
        const parent1 = createCommit({ message: "Parent 1", timestamp: 1000 });
        const parent1Id = await ctx.commitStore.storeCommit(parent1);

        const parent2 = createCommit({ message: "Parent 2", timestamp: 1001 });
        const parent2Id = await ctx.commitStore.storeCommit(parent2);

        const merge = createCommit({
          parents: [parent1Id, parent2Id],
          message: "Merge",
          timestamp: 2000,
        });
        const mergeId = await ctx.commitStore.storeCommit(merge);

        const parents = await ctx.commitStore.getParents(mergeId);
        expect(parents).toHaveLength(2);
        expect(parents[0]).toBe(parent1Id);
        expect(parents[1]).toBe(parent2Id);
      });

      it("preserves parent order", async () => {
        const parentIds = [
          fakeObjectId("parent1"),
          fakeObjectId("parent2"),
          fakeObjectId("parent3"),
        ];

        const commit = createCommit({ parents: parentIds, message: "Octopus merge" });
        const id = await ctx.commitStore.storeCommit(commit);

        const loaded = await ctx.commitStore.loadCommit(id);
        expect(loaded.parents).toEqual(parentIds);
      });
    });

    describe("Ancestry Walking", () => {
      it("walks linear history", async () => {
        // Create: A <- B <- C
        const a = createCommit({ message: "A", timestamp: 1000 });
        const aId = await ctx.commitStore.storeCommit(a);

        const b = createCommit({ parents: [aId], message: "B", timestamp: 2000 });
        const bId = await ctx.commitStore.storeCommit(b);

        const c = createCommit({ parents: [bId], message: "C", timestamp: 3000 });
        const cId = await ctx.commitStore.storeCommit(c);

        const ancestry = await collectAncestry(ctx.commitStore.walkAncestry(cId));

        expect(ancestry).toHaveLength(3);
        expect(ancestry[0]).toBe(cId);
        expect(ancestry[1]).toBe(bId);
        expect(ancestry[2]).toBe(aId);
      });

      it("walks from multiple starting points", async () => {
        const root = createCommit({ message: "Root", timestamp: 1000 });
        const rootId = await ctx.commitStore.storeCommit(root);

        const branch1 = createCommit({ parents: [rootId], message: "Branch1", timestamp: 2000 });
        const branch1Id = await ctx.commitStore.storeCommit(branch1);

        const branch2 = createCommit({ parents: [rootId], message: "Branch2", timestamp: 2001 });
        const branch2Id = await ctx.commitStore.storeCommit(branch2);

        const ancestry = await collectAncestry(
          ctx.commitStore.walkAncestry([branch1Id, branch2Id]),
        );

        expect(ancestry).toContain(rootId);
        expect(ancestry).toContain(branch1Id);
        expect(ancestry).toContain(branch2Id);
        // Root should only appear once
        expect(ancestry.filter((id) => id === rootId)).toHaveLength(1);
      });

      it("respects limit option", async () => {
        // Create: A <- B <- C <- D <- E
        let prevId: string | undefined;
        const ids: string[] = [];

        for (let i = 0; i < 5; i++) {
          const commit = createCommit({
            parents: prevId ? [prevId] : [],
            message: `Commit ${i}`,
            timestamp: 1000 + i * 1000,
          });
          prevId = await ctx.commitStore.storeCommit(commit);
          ids.push(prevId);
        }

        const ancestry = await collectAncestry(ctx.commitStore.walkAncestry(ids[4], { limit: 3 }));

        expect(ancestry).toHaveLength(3);
      });

      it("respects stopAt option", async () => {
        // Create: A <- B <- C <- D
        const a = createCommit({ message: "A", timestamp: 1000 });
        const aId = await ctx.commitStore.storeCommit(a);

        const b = createCommit({ parents: [aId], message: "B", timestamp: 2000 });
        const bId = await ctx.commitStore.storeCommit(b);

        const c = createCommit({ parents: [bId], message: "C", timestamp: 3000 });
        const cId = await ctx.commitStore.storeCommit(c);

        const d = createCommit({ parents: [cId], message: "D", timestamp: 4000 });
        const dId = await ctx.commitStore.storeCommit(d);

        // Stop at B (exclusive)
        const ancestry = await collectAncestry(
          ctx.commitStore.walkAncestry(dId, { stopAt: [bId] }),
        );

        expect(ancestry).toContain(dId);
        expect(ancestry).toContain(cId);
        expect(ancestry).not.toContain(bId);
        expect(ancestry).not.toContain(aId);
      });

      it("respects firstParentOnly option", async () => {
        // Create: A <- B <- Merge
        //               \<- C <-/
        const a = createCommit({ message: "A", timestamp: 1000 });
        const aId = await ctx.commitStore.storeCommit(a);

        const b = createCommit({ parents: [aId], message: "B", timestamp: 2000 });
        const bId = await ctx.commitStore.storeCommit(b);

        const c = createCommit({ parents: [aId], message: "C", timestamp: 2001 });
        const cId = await ctx.commitStore.storeCommit(c);

        const merge = createCommit({
          parents: [bId, cId],
          message: "Merge",
          timestamp: 3000,
        });
        const mergeId = await ctx.commitStore.storeCommit(merge);

        const ancestry = await collectAncestry(
          ctx.commitStore.walkAncestry(mergeId, { firstParentOnly: true }),
        );

        expect(ancestry).toContain(mergeId);
        expect(ancestry).toContain(bId);
        expect(ancestry).toContain(aId);
        expect(ancestry).not.toContain(cId);
      });
    });

    describe("Merge Base", () => {
      it("finds merge base for linear history", async () => {
        // A <- B <- C
        const a = createCommit({ message: "A", timestamp: 1000 });
        const aId = await ctx.commitStore.storeCommit(a);

        const b = createCommit({ parents: [aId], message: "B", timestamp: 2000 });
        const bId = await ctx.commitStore.storeCommit(b);

        const c = createCommit({ parents: [bId], message: "C", timestamp: 3000 });
        const cId = await ctx.commitStore.storeCommit(c);

        const bases = await ctx.commitStore.findMergeBase(bId, cId);
        expect(bases).toContain(bId);
      });

      it("finds merge base for diverged branches", async () => {
        //     /- B
        // A -<
        //     \- C
        const a = createCommit({ message: "A", timestamp: 1000 });
        const aId = await ctx.commitStore.storeCommit(a);

        const b = createCommit({ parents: [aId], message: "B", timestamp: 2000 });
        const bId = await ctx.commitStore.storeCommit(b);

        const c = createCommit({ parents: [aId], message: "C", timestamp: 2001 });
        const cId = await ctx.commitStore.storeCommit(c);

        const bases = await ctx.commitStore.findMergeBase(bId, cId);
        expect(bases).toContain(aId);
      });

      it("handles criss-cross merge", async () => {
        // A <- B <- D
        //  \    \  /
        //   \- C -X- E
        const a = createCommit({ message: "A", timestamp: 1000 });
        const aId = await ctx.commitStore.storeCommit(a);

        const b = createCommit({ parents: [aId], message: "B", timestamp: 2000 });
        const bId = await ctx.commitStore.storeCommit(b);

        const c = createCommit({ parents: [aId], message: "C", timestamp: 2001 });
        const cId = await ctx.commitStore.storeCommit(c);

        // D merges B and C
        const d = createCommit({ parents: [bId, cId], message: "D", timestamp: 3000 });
        const dId = await ctx.commitStore.storeCommit(d);

        // E merges C and B
        const e = createCommit({ parents: [cId, bId], message: "E", timestamp: 3001 });
        const eId = await ctx.commitStore.storeCommit(e);

        const bases = await ctx.commitStore.findMergeBase(dId, eId);
        // Both B and C are valid merge bases in criss-cross
        expect(bases.length).toBeGreaterThanOrEqual(1);
        expect(bases.some((b) => b === bId || b === cId)).toBe(true);
      });
    });

    describe("isAncestor", () => {
      it("returns true for direct ancestor", async () => {
        const a = createCommit({ message: "A", timestamp: 1000 });
        const aId = await ctx.commitStore.storeCommit(a);

        const b = createCommit({ parents: [aId], message: "B", timestamp: 2000 });
        const bId = await ctx.commitStore.storeCommit(b);

        expect(await ctx.commitStore.isAncestor(aId, bId)).toBe(true);
      });

      it("returns true for indirect ancestor", async () => {
        const a = createCommit({ message: "A", timestamp: 1000 });
        const aId = await ctx.commitStore.storeCommit(a);

        const b = createCommit({ parents: [aId], message: "B", timestamp: 2000 });
        const bId = await ctx.commitStore.storeCommit(b);

        const c = createCommit({ parents: [bId], message: "C", timestamp: 3000 });
        const cId = await ctx.commitStore.storeCommit(c);

        expect(await ctx.commitStore.isAncestor(aId, cId)).toBe(true);
      });

      it("returns true for same commit", async () => {
        const a = createCommit({ message: "A", timestamp: 1000 });
        const aId = await ctx.commitStore.storeCommit(a);

        expect(await ctx.commitStore.isAncestor(aId, aId)).toBe(true);
      });

      it("returns false for non-ancestor", async () => {
        const a = createCommit({ message: "A", timestamp: 1000 });
        const aId = await ctx.commitStore.storeCommit(a);

        const b = createCommit({ parents: [aId], message: "B", timestamp: 2000 });
        const bId = await ctx.commitStore.storeCommit(b);

        expect(await ctx.commitStore.isAncestor(bId, aId)).toBe(false);
      });

      it("returns false for unrelated commits", async () => {
        const a = createCommit({ message: "A", timestamp: 1000 });
        const aId = await ctx.commitStore.storeCommit(a);

        const b = createCommit({ message: "B", timestamp: 1001 });
        const bId = await ctx.commitStore.storeCommit(b);

        expect(await ctx.commitStore.isAncestor(aId, bId)).toBe(false);
        expect(await ctx.commitStore.isAncestor(bId, aId)).toBe(false);
      });
    });

    describe("Error Handling", () => {
      it("throws on loading non-existent commit", async () => {
        await expect(
          ctx.commitStore.loadCommit("nonexistent-commit-id-00000000"),
        ).rejects.toThrow();
      });
    });

    describe("Optional Fields", () => {
      it("preserves encoding field", async () => {
        const commit = createCommit({ message: "Test" });
        commit.encoding = "ISO-8859-1";
        const id = await ctx.commitStore.storeCommit(commit);

        const loaded = await ctx.commitStore.loadCommit(id);
        expect(loaded.encoding).toBe("ISO-8859-1");
      });

      it("preserves GPG signature", async () => {
        const commit = createCommit({ message: "Test" });
        commit.gpgSignature = "-----BEGIN PGP SIGNATURE-----\ntest\n-----END PGP SIGNATURE-----";
        const id = await ctx.commitStore.storeCommit(commit);

        const loaded = await ctx.commitStore.loadCommit(id);
        expect(loaded.gpgSignature).toBe(commit.gpgSignature);
      });
    });
  });
}
