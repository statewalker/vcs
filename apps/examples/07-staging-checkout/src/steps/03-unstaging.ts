/**
 * Step 3: Unstaging
 *
 * Demonstrates removing files from the staging area.
 */

import { addFileToStaging, getGit, printSection, printStep, resetState } from "../shared.js";

export async function step03Unstaging(): Promise<void> {
  printStep(3, "Unstaging");

  resetState();
  const { git, store } = await getGit();

  // Create initial state with multiple staged files
  console.log("\n--- Setting up staged files ---");

  await addFileToStaging(store, "README.md", "# Unstaging Demo");
  await git.commit().setMessage("Initial commit").call();

  await addFileToStaging(store, "src/keep.ts", "// This will stay staged");
  await addFileToStaging(store, "src/remove.ts", "// This will be unstaged");
  await addFileToStaging(store, "src/also-remove.ts", "// This will also be unstaged");

  console.log("  Staged files:");
  for await (const entry of store.staging.listEntries()) {
    console.log(`    ${entry.path}`);
  }

  // Method 1: Using git.reset() (high-level)
  console.log("\n--- Method 1: Using git.reset() ---");
  console.log(`
  git.reset() can unstage files:

    // Unstage specific file
    await git.reset().addPath("src/file.ts").call();

    // Unstage all files
    await git.reset().call();

    // Reset modes:
    //   soft   - Move HEAD, keep staging and working tree
    //   mixed  - Move HEAD, reset staging, keep working tree (default)
    //   hard   - Move HEAD, reset staging and working tree
  `);

  // Method 2: Using staging editor to remove
  console.log("\n--- Method 2: Using staging editor ---");

  const editor = store.staging.editor();
  editor.remove("src/remove.ts");
  await editor.finish();
  console.log("  Removed: src/remove.ts");

  console.log("\n  Remaining staged files:");
  for await (const entry of store.staging.listEntries()) {
    console.log(`    ${entry.path}`);
  }

  // Method 3: Rebuild staging without certain files
  console.log("\n--- Method 3: Rebuild staging ---");
  console.log("  (Useful for bulk operations)");

  // Collect entries to keep
  const entriesToKeep: Array<{
    path: string;
    mode: number;
    objectId: string;
    stage: number;
  }> = [];

  for await (const entry of store.staging.listEntries()) {
    if (entry.path !== "src/also-remove.ts") {
      entriesToKeep.push({
        path: entry.path,
        mode: entry.mode,
        objectId: entry.objectId,
        stage: entry.stage,
      });
    }
  }

  // Rebuild with filtered entries
  const builder = store.staging.builder();
  for (const entry of entriesToKeep) {
    builder.add(entry);
  }
  await builder.finish();

  console.log("\n  Final staged files:");
  for await (const entry of store.staging.listEntries()) {
    console.log(`    ${entry.path}`);
  }

  // Reset to HEAD tree
  console.log("\n--- Resetting staging to match HEAD ---");

  const head = await store.refs.resolve("HEAD");
  if (head?.objectId) {
    const commit = await store.commits.loadCommit(head.objectId);
    await store.staging.readTree(store.trees, commit.tree);
    console.log("  Reset staging to HEAD tree");

    console.log("\n  Staging now matches HEAD:");
    for await (const entry of store.staging.listEntries()) {
      console.log(`    ${entry.path}`);
    }
  }

  console.log("\n--- Unstaging Summary ---");
  console.log(`
  High-level:
    git.reset().addPath(path).call()   - Unstage specific file
    git.reset().call()                  - Unstage all (mixed reset)

  Low-level:
    editor.remove(path)                 - Remove single entry
    staging.readTree(trees, treeId)     - Reset to tree
    staging.builder()                   - Rebuild from scratch
  `);

  console.log("\nStep 3 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 3: Unstaging");
  step03Unstaging()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
