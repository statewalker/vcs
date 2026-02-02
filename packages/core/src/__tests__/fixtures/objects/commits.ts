import type { Person } from "../../../history/commits/types.js";
import { TREE_FIXTURES } from "./trees.js";

/**
 * Test commit fixtures.
 */
export const COMMIT_FIXTURES = {
  /**
   * Initial commit (no parents)
   */
  initial: {
    tree: TREE_FIXTURES.singleFile.hash,
    parents: [] as string[],
    author: {
      name: "Test Author",
      email: "author@test.com",
      timestamp: 1700000000,
      timezone: "+0000",
    } as Person,
    committer: {
      name: "Test Committer",
      email: "committer@test.com",
      timestamp: 1700000000,
      timezone: "+0000",
    } as Person,
    message: "Initial commit\n",
    hash: "computed",
  },

  /**
   * Regular commit (one parent)
   */
  regular: {
    tree: TREE_FIXTURES.multipleFiles.hash,
    parents: ["placeholder-parent-hash"] as string[],
    author: {
      name: "Test Author",
      email: "author@test.com",
      timestamp: 1700001000,
      timezone: "+0000",
    } as Person,
    committer: {
      name: "Test Committer",
      email: "committer@test.com",
      timestamp: 1700001000,
      timezone: "+0000",
    } as Person,
    message: "Add more files\n",
    hash: "computed",
  },

  /**
   * Merge commit (two parents)
   */
  merge: {
    tree: TREE_FIXTURES.multipleFiles.hash,
    parents: ["placeholder-parent1-hash", "placeholder-parent2-hash"] as string[],
    author: {
      name: "Test Author",
      email: "author@test.com",
      timestamp: 1700002000,
      timezone: "+0000",
    } as Person,
    committer: {
      name: "Test Committer",
      email: "committer@test.com",
      timestamp: 1700002000,
      timezone: "+0000",
    } as Person,
    message: "Merge branch 'feature'\n",
    hash: "computed",
  },
} as const;
