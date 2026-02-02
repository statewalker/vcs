import type { TreeEntry } from "../../../history/trees/types.js";
import { BLOB_FIXTURES } from "./blobs.js";

/**
 * Test tree fixtures with known structures.
 */
export const TREE_FIXTURES = {
  /**
   * Empty tree (special hash)
   */
  empty: {
    entries: [] as TreeEntry[],
    hash: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  },

  /**
   * Simple tree with one file
   */
  singleFile: {
    entries: [{ mode: "100644", name: "file.txt", hash: BLOB_FIXTURES.hello.hash }] as TreeEntry[],
    hash: "computed",
  },

  /**
   * Tree with multiple files
   */
  multipleFiles: {
    entries: [
      { mode: "100644", name: "README.md", hash: BLOB_FIXTURES.helloWorld.hash },
      { mode: "100755", name: "script.sh", hash: BLOB_FIXTURES.hello.hash },
      { mode: "100644", name: "data.txt", hash: BLOB_FIXTURES.hello.hash },
    ] as TreeEntry[],
    hash: "computed",
  },

  /**
   * Nested tree structure
   */
  nested: {
    structure: {
      "README.md": BLOB_FIXTURES.helloWorld.hash,
      "src/": {
        "index.js": BLOB_FIXTURES.hello.hash,
        "utils/": {
          "helper.js": BLOB_FIXTURES.hello.hash,
        },
      },
    },
    rootHash: "computed",
  },
} as const;

/**
 * Build tree entries from a nested structure.
 */
export async function buildTreeStructure(
  structure: Record<string, string | Record<string, unknown>>,
  storeTree: (entries: TreeEntry[]) => Promise<string>,
): Promise<string> {
  // Recursively build tree from structure
  const entries: TreeEntry[] = [];

  for (const [name, value] of Object.entries(structure)) {
    if (typeof value === "string") {
      // It's a blob hash
      entries.push({
        mode: name.endsWith(".sh") ? "100755" : "100644",
        name,
        hash: value,
      });
    } else {
      // It's a subtree
      const subtreeHash = await buildTreeStructure(
        value as Record<string, string | Record<string, unknown>>,
        storeTree,
      );
      entries.push({
        mode: "040000",
        name: name.replace(/\/$/, ""), // Remove trailing slash
        hash: subtreeHash,
      });
    }
  }

  return await storeTree(entries);
}
