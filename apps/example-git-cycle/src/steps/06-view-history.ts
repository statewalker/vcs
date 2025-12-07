/**
 * Step 6: View Version History
 *
 * This step demonstrates traversing and querying the commit history.
 *
 * Key concepts:
 * - walkAncestry() traverses the commit graph in topological order
 * - Options allow limiting traversal depth and stopping at specific commits
 * - isAncestor() checks commit relationships
 * - findMergeBase() finds common ancestors for merge operations
 *
 * @see packages/storage/src/commit-storage.ts - CommitStorage interface
 * @see packages/storage-git/src/git-commit-storage.ts - walkAncestry implementation
 */

import { getStorage, printSection, printStep, printSubsection, shortId } from "../shared/index.js";
import { storedCommits } from "./04-create-commits.js";

export async function step06ViewHistory(): Promise<void> {
  printStep(6, "View Version History");

  const storage = await getStorage();

  // Ensure we have commits
  if (!storedCommits.commit1) {
    console.log("  Note: Running previous steps to create commits...\n");
    const { step02CreateFiles } = await import("./02-create-files.js");
    const { step03BuildTrees } = await import("./03-build-trees.js");
    const { step04CreateCommits } = await import("./04-create-commits.js");
    const { step05UpdateFiles } = await import("./05-update-files.js");
    await step02CreateFiles();
    await step03BuildTrees();
    await step04CreateCommits();
    await step05UpdateFiles();
  }

  printSubsection("Walking full history");

  const headId = await storage.getHead();
  if (!headId) {
    console.log("\n  No HEAD found - repository may be empty");
    return;
  }
  console.log(`\n  HEAD: ${shortId(headId)}`);
  console.log(`\n  Commit history (newest first):`);
  console.log(`  ${"─".repeat(50)}`);

  let count = 0;
  for await (const commitId of storage.commits.walkAncestry(headId)) {
    const commit = await storage.commits.loadCommit(commitId);
    const date = new Date(commit.author.timestamp * 1000);
    const shortMsg = commit.message.split("\n")[0];

    count++;
    const marker = count === 1 ? " <- HEAD" : "";

    console.log(`\n  commit ${commitId}${marker}`);
    console.log(`  Author:  ${commit.author.name} <${commit.author.email}>`);
    console.log(`  Date:    ${date.toISOString()}`);
    console.log(`  Tree:    ${shortId(commit.tree)}`);
    if (commit.parents.length > 0) {
      console.log(`  Parents: ${commit.parents.map(shortId).join(", ")}`);
    } else {
      console.log(`  Parents: (none - initial commit)`);
    }
    console.log(`\n      ${shortMsg}`);
  }

  console.log(`\n  ${"─".repeat(50)}`);
  console.log(`  Total: ${count} commits`);

  printSubsection("Limited history walk");

  console.log(`\n  Using { limit: 2 } to get only the last 2 commits:`);

  let limitedCount = 0;
  for await (const commitId of storage.commits.walkAncestry(headId, { limit: 2 })) {
    limitedCount++;
    const commit = await storage.commits.loadCommit(commitId);
    console.log(`    ${limitedCount}. ${shortId(commitId)} - ${commit.message.split("\n")[0]}`);
  }

  printSubsection("Ancestry queries");

  console.log(`\n  Checking commit relationships:`);

  // Check if commit1 is ancestor of commit5
  const targetCommit = storedCommits.commit5 || headId;
  const isC1AncestorOfC5 = await storage.commits.isAncestor(storedCommits.commit1, targetCommit);
  console.log(`\n    Is ${shortId(storedCommits.commit1)} (initial) ancestor of HEAD?`);
  console.log(`    Result: ${isC1AncestorOfC5}`);

  // Check reverse
  const isC5AncestorOfC1 = await storage.commits.isAncestor(targetCommit, storedCommits.commit1);
  console.log(`\n    Is HEAD ancestor of ${shortId(storedCommits.commit1)} (initial)?`);
  console.log(`    Result: ${isC5AncestorOfC1}`);

  printSubsection("Getting parent commits");

  console.log(`\n  Parent chain from HEAD:`);

  let currentId: string | undefined = headId;
  let depth = 0;
  while (currentId) {
    const parents = await storage.commits.getParents(currentId);
    const indent = `    ${"  ".repeat(depth)}`;

    if (parents.length === 0) {
      console.log(`${indent}${shortId(currentId)} (no parents - initial commit)`);
      break;
    }

    console.log(`${indent}${shortId(currentId)} -> parent: ${parents.map(shortId).join(", ")}`);
    currentId = parents[0]; // Follow first parent
    depth++;

    if (depth > 10) {
      console.log(`${indent}  ... (truncated)`);
      break;
    }
  }

  printSubsection("Loading specific commits");

  // Get commit details by ID
  console.log(`\n  Loading commit ${shortId(storedCommits.commit1)} (initial):`);
  const initialCommit = await storage.commits.loadCommit(storedCommits.commit1);
  console.log(`    Message: ${initialCommit.message.split("\n")[0]}`);
  console.log(`    Tree:    ${shortId(initialCommit.tree)}`);

  // Get tree from commit
  const treeId = await storage.commits.getTree(storedCommits.commit1);
  console.log(`    getTree(): ${shortId(treeId)}`);

  // Check commit existence
  const exists = await storage.commits.hasCommit(storedCommits.commit1);
  console.log(`    Exists:  ${exists}`);

  const fakeId = "0".repeat(40);
  const fakeExists = await storage.commits.hasCommit(fakeId);
  console.log(`\n  Checking fake commit ${shortId(fakeId)}...:`);
  console.log(`    Exists:  ${fakeExists}`);

  printSubsection("History traversal summary");

  console.log(`
  walkAncestry() Options:
    { limit: N }          - Stop after N commits
    { stopAt: [ids] }     - Stop at specific commits (exclusive)
    { firstParentOnly }   - Only follow first parent (linear history)

  These options enable efficient partial traversals for:
    - Pagination (limit)
    - Pull request diffs (stopAt)
    - Linear history views (firstParentOnly)
`);
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 6: View Version History");
  step06ViewHistory()
    .then(() => console.log("\n  Done!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
