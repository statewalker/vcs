/**
 * Basic Repository Operations
 *
 * This example demonstrates the core Git workflow using low-level APIs:
 * - Initialize an in-memory repository
 * - Store a blob (file content)
 * - Create a tree (directory snapshot)
 * - Create a commit
 * - Update branch reference
 *
 * Run with: pnpm --filter @statewalker/vcs-example-readme-scripts basic-repository
 */

import { createGitRepository, FileMode } from "@statewalker/vcs-core";
import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";

// Initialize an in-memory repository
const files = new FilesApi(new MemFilesApi());
const repository = await createGitRepository(files, ".git", {
  create: true,
  defaultBranch: "main",
});

console.log("Repository initialized");

// Store a file as a blob
const content = new TextEncoder().encode("Hello, World!");
const blobId = await repository.blobs.store([content]);
console.log("Blob stored:", blobId);

// Create a tree (directory snapshot)
const treeId = await repository.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId },
]);
console.log("Tree stored:", treeId);

// Create a commit
const commitId = await repository.commits.storeCommit({
  tree: treeId,
  parents: [],
  author: {
    name: "Alice",
    email: "alice@example.com",
    timestamp: Date.now() / 1000,
    tzOffset: "+0000",
  },
  committer: {
    name: "Alice",
    email: "alice@example.com",
    timestamp: Date.now() / 1000,
    tzOffset: "+0000",
  },
  message: "Initial commit",
});
console.log("Commit stored:", commitId);

// Update the branch reference
await repository.refs.set("refs/heads/main", commitId);
console.log("Branch updated: refs/heads/main ->", commitId);

// Verify the commit is accessible
const head = await repository.getHead();
console.log("\nVerification:");
console.log("  HEAD points to:", head);
console.log("  Matches commit:", head === commitId ? "YES" : "NO");

// Load and verify the commit
const loadedCommit = await repository.commits.loadCommit(commitId);
console.log("  Commit message:", JSON.stringify(loadedCommit.message));
console.log("  Commit tree:", loadedCommit.tree);

console.log("\nBasic Repository Operations completed successfully!");
