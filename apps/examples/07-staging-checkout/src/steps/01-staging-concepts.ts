/**
 * Step 1: Staging Concepts
 *
 * Explains the index/staging area and its role in Git.
 */

import {
  addFileToStaging,
  formatMode,
  getGit,
  printSection,
  printStep,
  resetState,
  shortId,
} from "../shared.js";

export async function step01StagingConcepts(): Promise<void> {
  printStep(1, "Staging Concepts");

  console.log("\n--- What is the Staging Area? ---");
  console.log(`
  The staging area (also called "index") is a key Git concept:

  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
  │  Working Tree   │────▶│  Staging Area   │────▶│   Repository    │
  │                 │ add │    (Index)      │ commit  (Commits)    │
  │  Your files     │     │  Snapshot prep  │     │  History        │
  └─────────────────┘     └─────────────────┘     └─────────────────┘

  The staging area:
    - Holds the next commit's contents
    - Allows selective commits (stage some files, not others)
    - Tracks file metadata (mode, size, mtime)
    - Enables efficient status checks
  `);

  resetState();
  const { git, store } = await getGit();

  // Create initial commit
  console.log("\n--- Setting up repository ---");
  await addFileToStaging(store, "README.md", "# Staging Demo");
  await git.commit().setMessage("Initial commit").call();
  console.log("  Created initial commit");

  // Explain staging entry structure
  console.log("\n--- Staging Entry Structure ---");
  console.log(`
  Each entry in the staging area contains:
    - path:      File path relative to repository root
    - mode:      File mode (100644 for regular, 100755 for executable)
    - objectId:  SHA-1 hash of the file content (blob ID)
    - stage:     Merge stage (0 = normal, 1-3 = conflict stages)
    - size:      File size in bytes
    - mtime:     Modification time
  `);

  // Show current staging state
  console.log("\n--- Current staging area ---");

  let entryCount = 0;
  for await (const entry of store.staging.entries()) {
    entryCount++;
    console.log(`\n  Entry ${entryCount}:`);
    console.log(`    Path:     ${entry.path}`);
    console.log(`    Mode:     ${formatMode(entry.mode)}`);
    console.log(`    ObjectId: ${entry.objectId}`);
    console.log(`    Stage:    ${entry.stage}`);
  }

  // Explain stages
  console.log("\n--- Merge Stages ---");
  console.log(`
  Stage 0: Normal entry (no conflict)
  Stage 1: BASE    - Common ancestor version
  Stage 2: OURS    - Current branch version
  Stage 3: THEIRS  - Incoming branch version

  During a merge conflict, entries may appear at stages 1-3
  instead of stage 0 until the conflict is resolved.
  `);

  // Relationship to commits
  console.log("\n--- Staging vs Commits ---");
  console.log(`
  When you commit:
    1. Staging entries are written as a tree
    2. Tree is referenced by new commit
    3. Staging stays unchanged (still has same content)

  The staging area represents what the NEXT commit will contain.
  `);

  // Add more files to show staging growth
  console.log("\n--- Adding files to staging ---");

  await addFileToStaging(store, "src/index.ts", "export const app = {};");
  console.log("  Added: src/index.ts");

  await addFileToStaging(store, "src/utils.ts", "export const utils = {};");
  console.log("  Added: src/utils.ts");

  console.log("\n  Staging area now contains:");
  for await (const entry of store.staging.entries()) {
    console.log(`    ${entry.path} -> ${shortId(entry.objectId)}`);
  }

  console.log("\nStep 1 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 1: Staging Concepts");
  step01StagingConcepts()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
