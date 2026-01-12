/**
 * Quick Start Example
 *
 * Get running with statewalker-vcs in 5 minutes!
 *
 * This example demonstrates the core Git workflow:
 * - Initialize an in-memory repository
 * - Store file content (blob)
 * - Create a directory snapshot (tree)
 * - Make a commit
 * - Update branch reference
 *
 * Run with: pnpm start
 */

import { createGitRepository, createInMemoryFilesApi, FileMode } from "@statewalker/vcs-core";

// Initialize an in-memory repository
const files = createInMemoryFilesApi();
const repository = await createGitRepository(files, ".git", {
  create: true,
  defaultBranch: "main",
});

console.log("Repository initialized!");

// Store file content as a blob
// Blobs are content-addressable: identical content = identical ID
const encoder = new TextEncoder();
const content = encoder.encode("# My Project\n\nWelcome to my first VCS project!");
const blobId = await repository.blobs.store([content]);
console.log(`Blob stored: ${blobId.slice(0, 7)}`);

// Create a tree (directory snapshot)
// Trees contain entries with mode, name, and object ID
const treeId = await repository.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId },
]);
console.log(`Tree stored: ${treeId.slice(0, 7)}`);

// Create the initial commit
const now = Date.now() / 1000;
const commitId = await repository.commits.storeCommit({
  tree: treeId,
  parents: [],
  author: {
    name: "Developer",
    email: "dev@example.com",
    timestamp: now,
    tzOffset: "+0000",
  },
  committer: {
    name: "Developer",
    email: "dev@example.com",
    timestamp: now,
    tzOffset: "+0000",
  },
  message: "Initial commit",
});
console.log(`Commit created: ${commitId.slice(0, 7)}`);

// Update the branch reference
await repository.refs.set("refs/heads/main", commitId);
console.log("Branch updated: refs/heads/main");

// Verify everything works
const head = await repository.getHead();
console.log(`\nHEAD points to: ${head?.slice(0, 7)}`);

// Load and display the commit
const commit = await repository.commits.loadCommit(commitId);
console.log(`Commit message: "${commit.message}"`);
console.log(`Commit tree: ${commit.tree.slice(0, 7)}`);

// Create a second commit to show history
const content2 = encoder.encode(
  "# My Project\n\nWelcome to my first VCS project!\n\n## Features\n\n- Feature A\n- Feature B",
);
const blobId2 = await repository.blobs.store([content2]);
const treeId2 = await repository.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId2 },
]);
const commitId2 = await repository.commits.storeCommit({
  tree: treeId2,
  parents: [commitId],
  author: {
    name: "Developer",
    email: "dev@example.com",
    timestamp: now + 3600,
    tzOffset: "+0000",
  },
  committer: {
    name: "Developer",
    email: "dev@example.com",
    timestamp: now + 3600,
    tzOffset: "+0000",
  },
  message: "Add features section",
});
await repository.refs.set("refs/heads/main", commitId2);
console.log(`\nSecond commit: ${commitId2.slice(0, 7)}`);

// Show commit history
console.log("\nCommit history:");
for await (const historyCommitId of repository.commits.walkAncestry(commitId2)) {
  const historyCommit = await repository.commits.loadCommit(historyCommitId);
  console.log(
    `  - ${historyCommit.message} (${historyCommit.parents.length ? `parent: ${historyCommit.parents[0].slice(0, 7)}` : "initial"})`,
  );
}

console.log("\nQuick Start completed successfully!");
