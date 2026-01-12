/**
 * Step 2: Staging Changes
 *
 * Demonstrates adding files to the staging area.
 */

import {
  addFileToStaging,
  FileMode,
  getGit,
  printSection,
  printStep,
  resetState,
  shortId,
} from "../shared.js";

export async function step02StagingChanges(): Promise<void> {
  printStep(2, "Staging Changes");

  resetState();
  const { git, store } = await getGit();

  // Create initial commit
  await addFileToStaging(store, "README.md", "# Staging Demo");
  await git.commit().setMessage("Initial commit").call();

  console.log("\n--- Methods to stage files ---");

  // Method 1: Using git.add() command (high-level)
  console.log("\n1. Using git.add() (porcelain API):");
  console.log(`
   // Stage a single file
   await git.add().addFilepattern("src/index.ts").call();

   // Stage multiple files
   await git.add()
     .addFilepattern("src/")
     .addFilepattern("tests/")
     .call();

   // Stage all files
   await git.add().addFilepattern(".").call();
  `);

  // Method 2: Using staging editor (low-level)
  console.log("\n2. Using staging editor (low-level API):");

  // Store blob first
  const content1 = new TextEncoder().encode("export const v1 = 1;");
  const blobId1 = await store.blobs.store([content1]);
  console.log(`  Stored blob: ${shortId(blobId1)}`);

  // Add to staging via editor
  const editor = store.staging.editor();
  editor.add({
    path: "src/version.ts",
    apply: () => ({
      path: "src/version.ts",
      mode: FileMode.REGULAR_FILE,
      objectId: blobId1,
      stage: 0,
      size: content1.length,
      mtime: Date.now(),
    }),
  });
  await editor.finish();
  console.log("  Added to staging: src/version.ts");

  // Method 3: Using staging builder
  console.log("\n3. Using staging builder:");

  const content2 = new TextEncoder().encode("export const config = {};");
  const blobId2 = await store.blobs.store([content2]);

  const builder = store.staging.builder();
  builder.add({
    path: "src/config.ts",
    mode: FileMode.REGULAR_FILE,
    objectId: blobId2,
    stage: 0,
  });
  await builder.finish();
  console.log("  Added via builder: src/config.ts");

  // Show current staging state
  console.log("\n--- Current staging area ---");
  for await (const entry of store.staging.entries()) {
    console.log(`  ${entry.path} -> ${shortId(entry.objectId)}`);
  }

  // Demonstrate updating a staged file
  console.log("\n--- Updating a staged file ---");

  const content3 = new TextEncoder().encode("export const v2 = 2;");
  const blobId3 = await store.blobs.store([content3]);
  console.log(`  New blob: ${shortId(blobId3)}`);

  const updateEditor = store.staging.editor();
  updateEditor.add({
    path: "src/version.ts",
    apply: () => ({
      path: "src/version.ts",
      mode: FileMode.REGULAR_FILE,
      objectId: blobId3,
      stage: 0,
      size: content3.length,
      mtime: Date.now(),
    }),
  });
  await updateEditor.finish();
  console.log("  Updated: src/version.ts");

  // Show staging with updated file
  console.log("\n  Staging area after update:");
  for await (const entry of store.staging.entries()) {
    const marker = entry.path === "src/version.ts" ? " (updated)" : "";
    console.log(`  ${entry.path} -> ${shortId(entry.objectId)}${marker}`);
  }

  // Commit the staged changes
  console.log("\n--- Committing staged changes ---");
  const _commit = await git.commit().setMessage("Add source files").call();
  console.log(`  Created commit with staged files`);

  console.log("\n--- API Summary ---");
  console.log(`
  High-level:
    git.add().addFilepattern(pattern).call()

  Low-level:
    store.staging.editor()     - Edit staging entries
    store.staging.builder()    - Build staging from scratch
    store.staging.entries()    - Iterate entries

  Entry fields:
    path, mode, objectId, stage, size, mtime
  `);

  console.log("\nStep 2 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 2: Staging Changes");
  step02StagingChanges()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
