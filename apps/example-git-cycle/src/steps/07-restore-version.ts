/**
 * Step 7: Restore Specific Version
 *
 * This step demonstrates accessing files from any point in history.
 *
 * Key concepts:
 * - Each commit contains a complete tree snapshot
 * - You can load the tree from any commit to see its files
 * - Files can be read from any historical version
 * - Comparing versions shows what changed
 *
 * @see packages/storage/src/file-tree-storage.ts - loadTree, getEntry
 * @see packages/storage/src/object-storage.ts - load for content retrieval
 */

import {
  FileMode,
  getStorage,
  listFilesRecursive,
  printSection,
  printStep,
  printSubsection,
  readBlob,
  shortId,
} from "../shared/index.js";
import { storedCommits } from "./04-create-commits.js";

export async function step07RestoreVersion(): Promise<void> {
  printStep(7, "Restore Specific Version");

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

  printSubsection("Listing files in different commits");

  // List files in initial commit
  console.log(`\n  Files in initial commit (${shortId(storedCommits.commit1)}):`);
  const initialCommit = await storage.commits.loadCommit(storedCommits.commit1);
  const initialFiles = await listFilesRecursive(storage, initialCommit.tree);
  for (const [path, id] of initialFiles) {
    console.log(`    ${path} -> ${shortId(id)}`);
  }

  // List files in latest commit
  const headId = await storage.getHead();
  console.log(`\n  Files in HEAD (${shortId(headId!)}):`);
  const headCommit = await storage.commits.loadCommit(headId!);
  const headFiles = await listFilesRecursive(storage, headCommit.tree);
  for (const [path, id] of headFiles) {
    console.log(`    ${path} -> ${shortId(id)}`);
  }

  // Show files that were added/removed
  console.log(`\n  Changes between initial and HEAD:`);

  // Find added files
  for (const [path] of headFiles) {
    if (!initialFiles.has(path)) {
      console.log(`    + ${path} (added)`);
    }
  }

  // Find removed files (there shouldn't be any in this example after remove step)
  for (const [path] of initialFiles) {
    if (!headFiles.has(path)) {
      console.log(`    - ${path} (removed)`);
    }
  }

  // Find modified files
  for (const [path, id] of headFiles) {
    const oldId = initialFiles.get(path);
    if (oldId && oldId !== id) {
      console.log(`    ~ ${path} (modified: ${shortId(oldId)} -> ${shortId(id)})`);
    }
  }

  printSubsection("Reading file content from historical version");

  // Read README from initial commit
  const initialReadme = await storage.trees.getEntry(initialCommit.tree, "README.md");
  const initialContent = await readBlob(storage, initialReadme?.id);

  console.log(`\n  README.md from initial commit:`);
  console.log(`  ┌${"─".repeat(50)}┐`);
  for (const line of initialContent.split("\n").slice(0, 6)) {
    console.log(`  │ ${line.padEnd(48)} │`);
  }
  console.log(`  │ ${"...".padEnd(48)} │`);
  console.log(`  └${"─".repeat(50)}┘`);

  // Read README from latest commit
  const headReadme = await storage.trees.getEntry(headCommit.tree, "README.md");
  const headContent = await readBlob(storage, headReadme?.id);

  console.log(`\n  README.md from HEAD:`);
  console.log(`  ┌${"─".repeat(50)}┐`);
  for (const line of headContent.split("\n").slice(0, 8)) {
    console.log(`  │ ${line.padEnd(48)} │`);
  }
  console.log(`  │ ${"...".padEnd(48)} │`);
  console.log(`  └${"─".repeat(50)}┘`);

  printSubsection("Reading nested files from history");

  // Check if src/utils.js exists in different commits
  console.log(`\n  Checking for src/utils.js in different commits:`);

  // In initial commit (should not exist)
  const checkInCommit = async (commitId: string, path: string) => {
    const commit = await storage.commits.loadCommit(commitId);
    const parts = path.split("/");

    let currentTree = commit.tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const entry = await storage.trees.getEntry(currentTree, parts[i]);
      if (!entry || entry.mode !== FileMode.TREE) {
        return null;
      }
      currentTree = entry.id;
    }

    return storage.trees.getEntry(currentTree, parts[parts.length - 1]);
  };

  const srcUtilsInitial = await checkInCommit(storedCommits.commit1, "src/utils.js");
  console.log(`    Initial commit: ${srcUtilsInitial ? "exists" : "not found"}`);

  const srcUtilsCommit3 = storedCommits.commit3
    ? await checkInCommit(storedCommits.commit3, "src/utils.js")
    : null;
  console.log(
    `    After adding files: ${srcUtilsCommit3 ? `exists (${shortId(srcUtilsCommit3.id)})` : "not checked"}`,
  );

  const srcUtilsHead = await checkInCommit(headId!, "src/utils.js");
  console.log(`    HEAD: ${srcUtilsHead ? `exists (${shortId(srcUtilsHead.id)})` : "not found"}`);

  printSubsection("Restoring to a specific version");

  console.log(`
  To "restore" a version in webrun-vcs:

  1. Load the commit at that version:
     const commit = await storage.commits.loadCommit(oldCommitId);

  2. Get the tree snapshot:
     const tree = commit.tree;

  3. Read file contents:
     const entry = await storage.trees.getEntry(tree, "file.txt");
     const content = await readBlob(storage, entry.id);

  4. To create a "revert" commit:
     - Use the old tree with a new commit
     - Parent = current HEAD

  Example revert:
     const oldCommit = await storage.commits.loadCommit(targetId);
     const revertId = await storage.commits.storeCommit({
       tree: oldCommit.tree,
       parents: [headId],
       author, committer,
       message: \`Revert to \${shortId(targetId)}\`
     });
     await storage.refs.setRef("refs/heads/main", revertId);
`);

  printSubsection("Practical example: Reverting a commit");

  // Actually perform a revert
  const { createAuthor } = await import("../shared/index.js");
  const revertTarget = storedCommits.commit2; // Revert to after README update

  if (revertTarget) {
    const targetCommit = await storage.commits.loadCommit(revertTarget);

    const revertId = await storage.commits.storeCommit({
      tree: targetCommit.tree,
      parents: [headId!],
      author: createAuthor("Demo User", "demo@example.com", 10),
      committer: createAuthor("Demo User", "demo@example.com", 10),
      message: `Revert to "${targetCommit.message.split("\n")[0]}"`,
    });

    await storage.refs.setRef("refs/heads/main", revertId);

    console.log(`\n  Created revert commit: ${shortId(revertId)}`);
    console.log(`  Tree restored to: ${shortId(targetCommit.tree)}`);

    // Show files in reverted state
    console.log(`\n  Files in reverted state:`);
    const revertedFiles = await listFilesRecursive(storage, targetCommit.tree);
    for (const [path] of revertedFiles) {
      console.log(`    ${path}`);
    }
  }
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 7: Restore Specific Version");
  step07RestoreVersion()
    .then(() => console.log("\n  Done!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
