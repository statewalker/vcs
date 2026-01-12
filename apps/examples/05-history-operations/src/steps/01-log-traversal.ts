/**
 * Step 1: Log Traversal
 *
 * Demonstrates traversing commit history with filters.
 */

import {
  addFileToStaging,
  formatDate,
  getGit,
  printSection,
  printStep,
  resetState,
  shortId,
} from "../shared.js";

export async function step01LogTraversal(): Promise<void> {
  printStep(1, "Log Traversal");

  resetState();
  const { git, store } = await getGit();

  // Create a series of commits for log demonstration
  console.log("\n--- Setting up commit history ---");

  await addFileToStaging(store, "README.md", "# History Demo");
  await git.commit().setMessage("Initial commit").call();
  console.log("  Created: Initial commit");

  await addFileToStaging(store, "src/index.ts", "export const version = 1;");
  await git.commit().setMessage("Add src/index.ts").call();
  console.log("  Created: Add src/index.ts");

  await addFileToStaging(store, "src/utils.ts", "export const utils = {};");
  await git.commit().setMessage("Add src/utils.ts").call();
  console.log("  Created: Add src/utils.ts");

  await addFileToStaging(store, "docs/guide.md", "# Guide");
  await git.commit().setMessage("Add documentation").call();
  console.log("  Created: Add documentation");

  await addFileToStaging(store, "src/index.ts", "export const version = 2;");
  await git.commit().setMessage("Update version to 2").call();
  console.log("  Created: Update version to 2");

  // Basic log
  console.log("\n--- Basic log traversal ---");
  console.log("\nUsing git.log().call():");

  let count = 0;
  for await (const commit of await git.log().call()) {
    console.log(
      `  ${shortId(await store.commits.storeCommit(commit))} ${commit.message.split("\n")[0]}`,
    );
    count++;
  }
  console.log(`\n  Total commits: ${count}`);

  // Limited log
  console.log("\n--- Limited log (maxCount) ---");
  console.log("\nUsing git.log().setMaxCount(3).call():");

  for await (const commit of await git.log().setMaxCount(3).call()) {
    console.log(
      `  ${shortId(await store.commits.storeCommit(commit))} ${commit.message.split("\n")[0]}`,
    );
  }

  // Log with detailed info
  console.log("\n--- Detailed commit information ---");
  console.log("\nShowing full commit details:");

  let i = 0;
  for await (const commit of await git.log().setMaxCount(2).call()) {
    const commitId = await store.commits.storeCommit(commit);
    console.log(`\n  Commit ${++i}:`);
    console.log(`    ID:        ${commitId}`);
    console.log(`    Message:   ${commit.message.split("\n")[0]}`);
    console.log(`    Author:    ${commit.author.name} <${commit.author.email}>`);
    console.log(`    Date:      ${formatDate(commit.author.timestamp)}`);
    console.log(`    Tree:      ${shortId(commit.tree)}`);
    console.log(`    Parents:   ${commit.parents.map(shortId).join(", ") || "(none)"}`);
  }

  // Walk ancestry directly (low-level)
  console.log("\n--- Low-level: Walking ancestry ---");
  console.log("\nUsing store.commits.walkAncestry():");

  const head = await store.refs.resolve("HEAD");
  if (head?.objectId) {
    for await (const id of store.commits.walkAncestry(head.objectId, { limit: 3 })) {
      const commit = await store.commits.loadCommit(id);
      console.log(`  ${shortId(id)} ${commit.message.split("\n")[0]}`);
    }
  }

  console.log("\n--- Log API Summary ---");
  console.log(`
  git.log()                    - Start building log query
    .setMaxCount(n)            - Limit results
    .addPath(path)             - Filter by path (not yet implemented)
    .setStartCommit(id)        - Start from specific commit
    .call()                    - Execute and return async iterable

  Low-level:
    store.commits.walkAncestry(startId, { limit })
  `);

  console.log("\nStep 1 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 1: Log Traversal");
  step01LogTraversal()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
