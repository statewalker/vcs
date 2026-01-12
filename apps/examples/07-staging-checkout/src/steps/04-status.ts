/**
 * Step 4: Status
 *
 * Demonstrates checking repository status.
 */

import { addFileToStaging, getGit, printSection, printStep, resetState } from "../shared.js";

export async function step04Status(): Promise<void> {
  printStep(4, "Status");

  resetState();
  const { git, store } = await getGit();

  // Create initial commit
  console.log("\n--- Setting up repository ---");
  await addFileToStaging(store, "README.md", "# Status Demo");
  await addFileToStaging(store, "src/index.ts", "export const v1 = 1;");
  await git.commit().setMessage("Initial commit").call();
  console.log("  Created initial commit");

  // Check status of clean repository
  console.log("\n--- Clean repository status ---");

  let status = await git.status().call();
  console.log(`  isClean(): ${status.isClean()}`);
  console.log(`  Added:     ${[...status.added].length} files`);
  console.log(`  Changed:   ${[...status.changed].length} files`);
  console.log(`  Removed:   ${[...status.removed].length} files`);

  // Add new file (staged)
  console.log("\n--- After staging a new file ---");
  await addFileToStaging(store, "src/new-file.ts", "// New file");

  status = await git.status().call();
  console.log(`  isClean(): ${status.isClean()}`);
  console.log(`  Added:     ${[...status.added].join(", ") || "(none)"}`);

  // Modify existing file
  console.log("\n--- After modifying a file ---");
  await addFileToStaging(store, "src/index.ts", "export const v2 = 2;");

  status = await git.status().call();
  console.log(`  Changed:   ${[...status.changed].join(", ") || "(none)"}`);

  // Simulate removed file (by not including in staging rebuild)
  console.log("\n--- After removing a file ---");

  // Rebuild staging without README.md
  const entriesToKeep: Array<{ path: string; mode: number; objectId: string; stage: number }> = [];
  for await (const entry of store.staging.listEntries()) {
    if (entry.path !== "README.md") {
      entriesToKeep.push({
        path: entry.path,
        mode: entry.mode,
        objectId: entry.objectId,
        stage: entry.stage,
      });
    }
  }

  const builder = store.staging.builder();
  for (const entry of entriesToKeep) {
    builder.add(entry);
  }
  await builder.finish();

  status = await git.status().call();
  console.log(`  Removed:   ${[...status.removed].join(", ") || "(none)"}`);

  // Full status summary
  console.log("\n--- Full status summary ---");
  console.log(`
  Status categories:
    - added:       New files in staging (not in HEAD)
    - changed:     Modified files (in both, but different)
    - removed:     Deleted files (in HEAD, not in staging)
    - untracked:   Files in working tree, not in staging
    - conflicting: Files with merge conflicts (stages 1-3)
  `);

  // Show full status
  status = await git.status().call();
  console.log("  Current status:");
  console.log(`    Clean:       ${status.isClean()}`);
  console.log(`    Added:       ${[...status.added].join(", ") || "(none)"}`);
  console.log(`    Changed:     ${[...status.changed].join(", ") || "(none)"}`);
  console.log(`    Removed:     ${[...status.removed].join(", ") || "(none)"}`);
  console.log(`    Conflicting: ${[...status.conflicting].join(", ") || "(none)"}`);

  // Status API
  console.log("\n--- Status API ---");
  console.log(`
  const status = await git.status().call();

  // Collections
  status.added        // Set<string> - new files
  status.changed      // Set<string> - modified files
  status.removed      // Set<string> - deleted files
  status.untracked    // Set<string> - untracked files
  status.conflicting  // Set<string> - conflicted files

  // Helper
  status.isClean()    // boolean - true if no changes
  `);

  console.log("\nStep 4 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 4: Status");
  step04Status()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
