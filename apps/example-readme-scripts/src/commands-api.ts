/**
 * Commands API
 *
 * This example demonstrates the high-level Git command API:
 * - Create a Git facade with Git.wrap()
 * - Stage content and create commits
 * - Check repository status
 * - Create and checkout branches
 *
 * Note: The README shows git.add().addFilepattern(".") which requires a working
 * tree iterator (filesystem access). This example uses direct staging manipulation
 * for in-memory demonstration, then shows the Commands API for commits, branches,
 * and status - which work the same way regardless of storage backend.
 *
 * Run with: pnpm --filter @statewalker/vcs-example-readme-scripts commands-api
 */

import { createGitStore, Git } from "@statewalker/vcs-commands";
import { createGitRepository, FileMode } from "@statewalker/vcs-core";
import { MemoryStagingStore } from "@statewalker/vcs-store-mem";

// Create repository and staging
const repository = await createGitRepository();
const staging = new MemoryStagingStore();
const store = createGitStore({ repository, staging });
const git = Git.wrap(store);

console.log("Git facade created");

// Helper function to add a file to staging (simulates git add for in-memory use)
async function addFileToStaging(path: string, content: string): Promise<void> {
  const data = new TextEncoder().encode(content);
  const objectId = await store.blobs.store([data]);

  const editor = store.staging.editor();
  editor.add({
    path,
    apply: () => ({
      path,
      mode: FileMode.REGULAR_FILE,
      objectId,
      stage: 0,
      size: data.length,
      mtime: Date.now(),
    }),
  });
  await editor.finish();
}

// Stage files (in-memory equivalent of git add)
await addFileToStaging("README.md", "# My Project\n\nA sample project.");
await addFileToStaging("src/index.ts", 'console.log("Hello, World!");');
console.log("Files staged");

// Commit using the Commands API (like git commit -m "...")
const commitResult = await git.commit().setMessage("Initial commit").call();
console.log("Commit created:", commitResult.id);

// Check status using the Commands API
const status = await git.status().call();
console.log("\nStatus check:");
console.log("  Clean:", status.isClean());
console.log("  Added files:", status.added.size);
console.log("  Changed files:", status.changed.size);

// Create a branch using the Commands API (like git branch feature)
await git.branchCreate().setName("feature").call();
console.log("\nBranch 'feature' created");

// List branches
const branches = await git.branchList().call();
console.log("Branches:", branches.map((b) => b.name).join(", "));

// Checkout the feature branch (like git checkout feature)
await git.checkout().setName("feature").call();
console.log("Checked out 'feature' branch");

// Verify HEAD is on feature branch
const headRef = await store.refs.get("HEAD");
if (headRef && "target" in headRef) {
  console.log("HEAD points to:", headRef.target);
}

// Make a change on the feature branch
await addFileToStaging("src/feature.ts", "export const feature = true;");
const featureCommit = await git.commit().setMessage("Add feature module").call();
console.log("\nFeature commit:", featureCommit.id);

// View commit history using the Commands API
console.log("\nCommit history:");
for await (const commit of await git.log().call()) {
  console.log(`  - ${commit.message.trim()}`);
}

// Switch back to main
await git.checkout().setName("main").call();
console.log("\nSwitched back to 'main'");

// Create a tag
await git.tag().setName("v1.0.0").call();
console.log("Created tag 'v1.0.0'");

// List tags
const tags = await git.tagList().call();
console.log("Tags:", tags.map((t) => t.name).join(", "));

console.log("\nCommands API example completed successfully!");
