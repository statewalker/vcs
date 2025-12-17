/**
 * Parametrized test suite for TreeStore implementations
 *
 * This suite tests the core TreeStore interface contract.
 * All storage implementations must pass these tests.
 */

import type { TreeEntry, TreeStore } from "@webrun-vcs/vcs";
import { FileMode } from "@webrun-vcs/vcs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Well-known empty tree SHA-1 hash
 */
const EMPTY_TREE_ID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Context provided by the storage factory
 */
export interface TreeStoreTestContext {
  treeStore: TreeStore;
  cleanup?: () => Promise<void>;
}

/**
 * Factory function to create a storage instance for testing
 */
export type TreeStoreFactory = () => Promise<TreeStoreTestContext>;

/**
 * Helper function to generate a fake object ID (for testing)
 */
function fakeObjectId(seed: string): string {
  const hash = seed.padEnd(40, "0").slice(0, 40);
  return hash;
}

/**
 * Helper function to collect tree entries into an array
 */
async function collectEntries(iterable: AsyncIterable<TreeEntry>): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  for await (const entry of iterable) {
    entries.push(entry);
  }
  return entries;
}

/**
 * Create the TreeStore test suite with a specific factory
 *
 * @param name Name of the storage implementation (e.g., "Memory", "SQL", "KV")
 * @param factory Factory function to create storage instances
 */
export function createTreeStoreTests(name: string, factory: TreeStoreFactory): void {
  describe(`TreeStore [${name}]`, () => {
    let ctx: TreeStoreTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup?.();
    });

    describe("Basic Operations", () => {
      it("stores and retrieves tree entries", async () => {
        const entries: TreeEntry[] = [
          { mode: FileMode.REGULAR_FILE, name: "file.txt", id: fakeObjectId("abc123") },
          { mode: FileMode.TREE, name: "subdir", id: fakeObjectId("def456") },
        ];

        const id = await ctx.treeStore.storeTree(entries);
        expect(id).toBeDefined();
        expect(typeof id).toBe("string");

        const loaded = await collectEntries(ctx.treeStore.loadTree(id));
        expect(loaded).toHaveLength(2);
      });

      it("returns consistent IDs for same entries", async () => {
        const entries: TreeEntry[] = [
          { mode: FileMode.REGULAR_FILE, name: "a.txt", id: fakeObjectId("aaa") },
        ];

        const id1 = await ctx.treeStore.storeTree(entries);
        const id2 = await ctx.treeStore.storeTree(entries);
        expect(id1).toBe(id2);
      });

      it("returns different IDs for different entries", async () => {
        const id1 = await ctx.treeStore.storeTree([
          { mode: FileMode.REGULAR_FILE, name: "a.txt", id: fakeObjectId("aaa") },
        ]);
        const id2 = await ctx.treeStore.storeTree([
          { mode: FileMode.REGULAR_FILE, name: "b.txt", id: fakeObjectId("bbb") },
        ]);
        expect(id1).not.toBe(id2);
      });

      it("checks existence via hasTree", async () => {
        const entries: TreeEntry[] = [
          { mode: FileMode.REGULAR_FILE, name: "test.txt", id: fakeObjectId("test") },
        ];
        const id = await ctx.treeStore.storeTree(entries);

        expect(await ctx.treeStore.hasTree(id)).toBe(true);
        expect(await ctx.treeStore.hasTree("nonexistent-tree-id-000000000000")).toBe(false);
      });
    });

    describe("Canonical Sorting", () => {
      it("sorts entries alphabetically by name", async () => {
        const entries: TreeEntry[] = [
          { mode: FileMode.REGULAR_FILE, name: "z.txt", id: fakeObjectId("z") },
          { mode: FileMode.REGULAR_FILE, name: "a.txt", id: fakeObjectId("a") },
          { mode: FileMode.REGULAR_FILE, name: "m.txt", id: fakeObjectId("m") },
        ];

        const id = await ctx.treeStore.storeTree(entries);
        const loaded = await collectEntries(ctx.treeStore.loadTree(id));

        expect(loaded[0].name).toBe("a.txt");
        expect(loaded[1].name).toBe("m.txt");
        expect(loaded[2].name).toBe("z.txt");
      });

      it("sorts directories with trailing slash semantics", async () => {
        // Git sorts directories as if they have a trailing '/'
        // ASCII: '-' (45) < '.' (46) < '/' (47)
        // So: foo-bar < foo.txt < foo/ (directory)
        const entries: TreeEntry[] = [
          { mode: FileMode.REGULAR_FILE, name: "foo-bar", id: fakeObjectId("foobar") },
          { mode: FileMode.TREE, name: "foo", id: fakeObjectId("foo") },
          { mode: FileMode.REGULAR_FILE, name: "foo.txt", id: fakeObjectId("footxt") },
        ];

        const id = await ctx.treeStore.storeTree(entries);
        const loaded = await collectEntries(ctx.treeStore.loadTree(id));

        // foo-bar < foo.txt < foo (dir treated as "foo/")
        expect(loaded.map((e) => e.name)).toEqual(["foo-bar", "foo.txt", "foo"]);
      });

      it("produces consistent hash regardless of input order", async () => {
        const entriesA: TreeEntry[] = [
          { mode: FileMode.REGULAR_FILE, name: "z.txt", id: fakeObjectId("z") },
          { mode: FileMode.REGULAR_FILE, name: "a.txt", id: fakeObjectId("a") },
        ];
        const entriesB: TreeEntry[] = [
          { mode: FileMode.REGULAR_FILE, name: "a.txt", id: fakeObjectId("a") },
          { mode: FileMode.REGULAR_FILE, name: "z.txt", id: fakeObjectId("z") },
        ];

        const id1 = await ctx.treeStore.storeTree(entriesA);
        const id2 = await ctx.treeStore.storeTree(entriesB);
        expect(id1).toBe(id2);
      });
    });

    describe("Empty Tree", () => {
      it("has well-known empty tree ID", () => {
        const emptyId = ctx.treeStore.getEmptyTreeId();
        expect(emptyId).toBe(EMPTY_TREE_ID);
      });

      it("stores empty tree with well-known ID", async () => {
        const id = await ctx.treeStore.storeTree([]);
        expect(id).toBe(EMPTY_TREE_ID);
      });

      it("reports empty tree as existing", async () => {
        expect(await ctx.treeStore.hasTree(EMPTY_TREE_ID)).toBe(true);
      });

      it("loads empty tree as empty iterable", async () => {
        const entries = await collectEntries(ctx.treeStore.loadTree(EMPTY_TREE_ID));
        expect(entries).toHaveLength(0);
      });
    });

    describe("Entry Lookup", () => {
      it("finds entry by name", async () => {
        const entries: TreeEntry[] = [
          { mode: FileMode.REGULAR_FILE, name: "target.txt", id: fakeObjectId("target") },
          { mode: FileMode.REGULAR_FILE, name: "other.txt", id: fakeObjectId("other") },
        ];
        const id = await ctx.treeStore.storeTree(entries);

        const found = await ctx.treeStore.getEntry(id, "target.txt");
        expect(found).toBeDefined();
        expect(found?.name).toBe("target.txt");
        expect(found?.id).toBe(fakeObjectId("target"));
      });

      it("returns undefined for missing entry", async () => {
        const entries: TreeEntry[] = [
          { mode: FileMode.REGULAR_FILE, name: "exists.txt", id: fakeObjectId("exists") },
        ];
        const id = await ctx.treeStore.storeTree(entries);

        const found = await ctx.treeStore.getEntry(id, "missing.txt");
        expect(found).toBeUndefined();
      });

      it("returns undefined for empty tree entry lookup", async () => {
        const found = await ctx.treeStore.getEntry(EMPTY_TREE_ID, "anything");
        expect(found).toBeUndefined();
      });
    });

    describe("File Modes", () => {
      it("preserves file mode for regular files", async () => {
        const entries: TreeEntry[] = [
          { mode: FileMode.REGULAR_FILE, name: "regular.txt", id: fakeObjectId("reg") },
        ];
        const id = await ctx.treeStore.storeTree(entries);
        const loaded = await collectEntries(ctx.treeStore.loadTree(id));

        expect(loaded[0].mode).toBe(FileMode.REGULAR_FILE);
      });

      it("preserves file mode for executable files", async () => {
        const entries: TreeEntry[] = [
          { mode: FileMode.EXECUTABLE_FILE, name: "script.sh", id: fakeObjectId("exec") },
        ];
        const id = await ctx.treeStore.storeTree(entries);
        const loaded = await collectEntries(ctx.treeStore.loadTree(id));

        expect(loaded[0].mode).toBe(FileMode.EXECUTABLE_FILE);
      });

      it("preserves file mode for symlinks", async () => {
        const entries: TreeEntry[] = [
          { mode: FileMode.SYMLINK, name: "link", id: fakeObjectId("sym") },
        ];
        const id = await ctx.treeStore.storeTree(entries);
        const loaded = await collectEntries(ctx.treeStore.loadTree(id));

        expect(loaded[0].mode).toBe(FileMode.SYMLINK);
      });

      it("preserves file mode for directories", async () => {
        const entries: TreeEntry[] = [
          { mode: FileMode.TREE, name: "dir", id: fakeObjectId("dir") },
        ];
        const id = await ctx.treeStore.storeTree(entries);
        const loaded = await collectEntries(ctx.treeStore.loadTree(id));

        expect(loaded[0].mode).toBe(FileMode.TREE);
      });

      it("preserves file mode for gitlinks", async () => {
        const entries: TreeEntry[] = [
          { mode: FileMode.GITLINK, name: "submodule", id: fakeObjectId("git") },
        ];
        const id = await ctx.treeStore.storeTree(entries);
        const loaded = await collectEntries(ctx.treeStore.loadTree(id));

        expect(loaded[0].mode).toBe(FileMode.GITLINK);
      });
    });

    describe("Async Input", () => {
      it("accepts async iterable input", async () => {
        async function* generateEntries(): AsyncIterable<TreeEntry> {
          yield { mode: FileMode.REGULAR_FILE, name: "async1.txt", id: fakeObjectId("async1") };
          yield { mode: FileMode.REGULAR_FILE, name: "async2.txt", id: fakeObjectId("async2") };
        }

        const id = await ctx.treeStore.storeTree(generateEntries());
        const loaded = await collectEntries(ctx.treeStore.loadTree(id));

        expect(loaded).toHaveLength(2);
      });

      it("accepts sync generator input", async () => {
        function* generateEntries(): Iterable<TreeEntry> {
          yield { mode: FileMode.REGULAR_FILE, name: "sync1.txt", id: fakeObjectId("sync1") };
          yield { mode: FileMode.REGULAR_FILE, name: "sync2.txt", id: fakeObjectId("sync2") };
        }

        const id = await ctx.treeStore.storeTree(generateEntries());
        const loaded = await collectEntries(ctx.treeStore.loadTree(id));

        expect(loaded).toHaveLength(2);
      });
    });

    describe("Large Trees", () => {
      it("handles trees with many entries", { timeout: 30000 }, async () => {
        const entries: TreeEntry[] = [];
        for (let i = 0; i < 1000; i++) {
          entries.push({
            mode: FileMode.REGULAR_FILE,
            name: `file-${i.toString().padStart(4, "0")}.txt`,
            id: fakeObjectId(`file${i}`),
          });
        }

        const id = await ctx.treeStore.storeTree(entries);
        const loaded = await collectEntries(ctx.treeStore.loadTree(id));

        expect(loaded).toHaveLength(1000);
        // Verify sorting
        expect(loaded[0].name).toBe("file-0000.txt");
        expect(loaded[999].name).toBe("file-0999.txt");
      });
    });

    describe("Error Handling", () => {
      it("throws on loading non-existent tree", async () => {
        await expect(async () => {
          for await (const _ of ctx.treeStore.loadTree("nonexistent-tree-id-000000000000")) {
            // Should not reach here
          }
        }).rejects.toThrow();
      });
    });

    describe("Unicode Names", () => {
      it("handles unicode filenames", async () => {
        const entries: TreeEntry[] = [
          { mode: FileMode.REGULAR_FILE, name: "файл.txt", id: fakeObjectId("russian") },
          { mode: FileMode.REGULAR_FILE, name: "文件.txt", id: fakeObjectId("chinese") },
          { mode: FileMode.REGULAR_FILE, name: "αβγ.txt", id: fakeObjectId("greek") },
        ];

        const id = await ctx.treeStore.storeTree(entries);
        const loaded = await collectEntries(ctx.treeStore.loadTree(id));

        expect(loaded).toHaveLength(3);
        expect(loaded.map((e) => e.name)).toContain("файл.txt");
        expect(loaded.map((e) => e.name)).toContain("文件.txt");
        expect(loaded.map((e) => e.name)).toContain("αβγ.txt");
      });
    });
  });
}
