/**
 * Step 3: Commit Anatomy
 *
 * Demonstrates the structure of Git commit objects.
 * Commits link a tree snapshot to the history chain.
 */

import {
  FileMode,
  getRepository,
  printSection,
  printStep,
  printSubsection,
  shortId,
  storeBlob,
} from "../shared.js";

export async function step03CommitAnatomy(): Promise<void> {
  printStep(3, "Commit Anatomy");

  const { repository } = await getRepository();

  printSubsection("Creating content for the commit");

  const readmeId = await storeBlob(repository, "# My Project\n\nVersion 1");
  const treeId = await repository.trees.storeTree([
    { mode: FileMode.REGULAR_FILE, name: "README.md", id: readmeId },
  ]);

  console.log(`\n  Tree ID: ${shortId(treeId)}`);

  printSubsection("Creating the initial commit");

  const now = Date.now() / 1000;
  const author = {
    name: "Alice Developer",
    email: "alice@example.com",
    timestamp: now,
    tzOffset: "-0500",
  };

  const commitId = await repository.commits.storeCommit({
    tree: treeId,
    parents: [], // Initial commit has no parents
    author,
    committer: author,
    message: "Initial commit\n\nThis is the first commit in the repository.",
  });

  console.log(`\n  Commit ID: ${commitId}`);
  console.log(`  Short ID: ${shortId(commitId)}`);

  printSubsection("Commit object structure");

  const commit = await repository.commits.loadCommit(commitId);

  console.log(`\n  Commit components:`);
  console.log(`    tree:      ${shortId(commit.tree)}`);
  console.log(
    `    parents:   ${commit.parents.length === 0 ? "(none - initial commit)" : commit.parents.map(shortId).join(", ")}`,
  );
  console.log(`    author:    ${commit.author.name} <${commit.author.email}>`);
  console.log(`    timestamp: ${new Date(commit.author.timestamp * 1000).toISOString()}`);
  console.log(`    timezone:  ${commit.author.tzOffset}`);
  console.log(`    committer: ${commit.committer.name} <${commit.committer.email}>`);
  console.log(`    message:   ${commit.message.split("\n")[0]}`);

  printSubsection("Creating a second commit with parent");

  const readmeV2Id = await storeBlob(repository, "# My Project\n\nVersion 2 - with updates!");
  const treeV2Id = await repository.trees.storeTree([
    { mode: FileMode.REGULAR_FILE, name: "README.md", id: readmeV2Id },
  ]);

  const commit2Id = await repository.commits.storeCommit({
    tree: treeV2Id,
    parents: [commitId], // Reference to parent commit
    author: {
      name: "Bob Developer",
      email: "bob@example.com",
      timestamp: now + 3600,
      tzOffset: "-0500",
    },
    committer: {
      name: "Bob Developer",
      email: "bob@example.com",
      timestamp: now + 3600,
      tzOffset: "-0500",
    },
    message: "Update README with version 2",
  });

  const commit2 = await repository.commits.loadCommit(commit2Id);

  console.log(`\n  Second commit: ${shortId(commit2Id)}`);
  console.log(`    parents: [${commit2.parents.map(shortId).join(", ")}]`);
  console.log(`    message: ${commit2.message}`);

  printSubsection("Commit graph visualization");

  console.log(`\n  Commit history (newest first):`);
  console.log(`    ${shortId(commit2Id)} - ${commit2.message.split("\n")[0]}`);
  console.log(`    │`);
  console.log(`    └── parent: ${shortId(commitId)} - ${commit.message.split("\n")[0]}`);
  console.log(`        │`);
  console.log(`        └── (no parent - initial commit)`);

  printSubsection("Key takeaways");

  console.log(`\n  Each commit contains:`);
  console.log(`    - tree: snapshot of all files at that point`);
  console.log(`    - parents: link to previous commit(s)`);
  console.log(`    - author: who wrote the changes`);
  console.log(`    - committer: who applied the commit`);
  console.log(`    - message: description of changes`);

  // Update refs
  await repository.refs.set("refs/heads/main", commit2Id);

  console.log("\nStep 3 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 3: Commit Anatomy");
  step03CommitAnatomy()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
