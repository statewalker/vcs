/**
 * Step 7: Clean and Reset
 *
 * Demonstrates cleaning working tree and reset operations.
 */

import {
  addFileToStaging,
  getGit,
  printSection,
  printStep,
  resetState,
  shortId,
} from "../shared.js";

export async function step07CleanReset(): Promise<void> {
  printStep(7, "Clean and Reset");

  resetState();
  const { git, store } = await getGit();

  // Create commit history
  console.log("\n--- Setting up commit history ---");

  await addFileToStaging(store, "README.md", "# Reset Demo");
  await git.commit().setMessage("Initial commit").call();
  const head1 = await store.refs.resolve("HEAD");
  const commit1 = head1?.objectId ?? "";
  console.log(`  Commit 1: ${shortId(commit1)} - Initial commit`);

  await addFileToStaging(store, "src/index.ts", "// v1");
  await git.commit().setMessage("Add index.ts").call();
  const head2 = await store.refs.resolve("HEAD");
  const commit2 = head2?.objectId ?? "";
  console.log(`  Commit 2: ${shortId(commit2)} - Add index.ts`);

  await addFileToStaging(store, "src/index.ts", "// v2");
  await git.commit().setMessage("Update index.ts").call();
  const head3 = await store.refs.resolve("HEAD");
  const commit3 = head3?.objectId ?? "";
  console.log(`  Commit 3: ${shortId(commit3)} - Update index.ts`);

  // Explain reset modes
  console.log("\n--- Reset Modes ---");
  console.log(`
  git reset has three modes:

  ┌─────────────────────────────────────────────────────────────┐
  │  Mode     │  HEAD  │  Staging  │  Working Tree            │
  ├───────────┼────────┼───────────┼──────────────────────────┤
  │  --soft   │  Moves │  Unchanged│  Unchanged               │
  │  --mixed  │  Moves │  Reset    │  Unchanged  (default)    │
  │  --hard   │  Moves │  Reset    │  Reset                   │
  └─────────────────────────────────────────────────────────────┘

  Soft:  "Undo commit, keep changes staged"
  Mixed: "Undo commit, unstage changes"
  Hard:  "Undo commit, discard all changes"
  `);

  // Demonstrate soft reset
  console.log("\n--- Soft Reset ---");
  console.log(`  Current HEAD: ${shortId(commit3)}`);
  console.log("  Resetting to commit 2 with --soft...");

  // Soft reset: only move HEAD/branch
  await store.refs.set("refs/heads/main", commit2);
  // Note: HEAD still points to main symbolically

  const afterSoft = await store.refs.resolve("HEAD");
  console.log(`  HEAD after soft reset: ${shortId(afterSoft?.objectId || "")}`);
  console.log("  Staging is unchanged (still has v2 changes)");

  // Show staging
  console.log("\n  Staging area:");
  for await (const entry of store.staging.entries()) {
    console.log(`    ${entry.path} -> ${shortId(entry.objectId)}`);
  }

  // Restore for next demo
  await store.refs.set("refs/heads/main", commit3);
  const commit3Data = await store.commits.loadCommit(commit3);
  await store.staging.readTree(store.trees, commit3Data.tree);

  // Demonstrate mixed reset
  console.log("\n--- Mixed Reset (default) ---");
  console.log(`  Current HEAD: ${shortId(commit3)}`);
  console.log("  Resetting to commit 2 with --mixed...");

  // Mixed reset: move HEAD and reset staging
  await store.refs.set("refs/heads/main", commit2);
  const commit2Data = await store.commits.loadCommit(commit2);
  await store.staging.readTree(store.trees, commit2Data.tree);

  const afterMixed = await store.refs.resolve("HEAD");
  console.log(`  HEAD after mixed reset: ${shortId(afterMixed?.objectId || "")}`);

  console.log("\n  Staging area (matches commit 2):");
  for await (const entry of store.staging.entries()) {
    console.log(`    ${entry.path} -> ${shortId(entry.objectId)}`);
  }

  // Restore for next demo
  await store.refs.set("refs/heads/main", commit3);
  await store.staging.readTree(store.trees, commit3Data.tree);

  // Demonstrate hard reset
  console.log("\n--- Hard Reset ---");
  console.log(`  Current HEAD: ${shortId(commit3)}`);
  console.log("  Resetting to commit 1 with --hard...");
  console.log("  (In a real repo, this would also update working tree)");

  await store.refs.set("refs/heads/main", commit1);
  const commit1Data = await store.commits.loadCommit(commit1);
  await store.staging.readTree(store.trees, commit1Data.tree);

  const afterHard = await store.refs.resolve("HEAD");
  console.log(`  HEAD after hard reset: ${shortId(afterHard?.objectId || "")}`);

  console.log("\n  Staging area (matches commit 1):");
  for await (const entry of store.staging.entries()) {
    console.log(`    ${entry.path} -> ${shortId(entry.objectId)}`);
  }

  // Clean command
  console.log("\n--- Clean Command ---");
  console.log(`
  git.clean() removes untracked files from working tree.

  Options:
    setDryRun(true)   - Show what would be removed
    setForce(true)    - Required to actually delete
    setDirectories(true) - Also remove untracked directories

  Note: In this in-memory demo, we don't have actual untracked files.
  `);

  // Reset API summary
  console.log("\n--- Reset API ---");
  console.log(`
  // Soft reset
  await git.reset()
    .setRef("HEAD~1")
    .setMode("soft")
    .call();

  // Mixed reset (default)
  await git.reset()
    .setRef(commitId)
    .call();

  // Hard reset
  await git.reset()
    .setRef(commitId)
    .setMode("hard")
    .call();

  // Reset specific file
  await git.reset()
    .addPath("path/to/file")
    .call();
  `);

  // Use cases
  console.log("\n--- Common Use Cases ---");
  console.log(`
  Undo last commit, keep changes:
    git reset --soft HEAD~1

  Unstage all files:
    git reset

  Discard all local changes:
    git reset --hard HEAD

  Reset to remote state:
    git reset --hard origin/main

  Undo file modification (restore from staging):
    git checkout -- file.txt
  `);

  console.log("\nStep 7 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 7: Clean and Reset");
  step07CleanReset()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
