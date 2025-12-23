/**
 * Main Entry Point: Complete Git Cycle Example
 *
 * This script runs all steps of the Git workflow example in sequence.
 * Each step demonstrates a key aspect of the webrun-vcs library.
 *
 * Run with: pnpm start (or: pnpm --filter @webrun-vcs/example-git-cycle start)
 *
 * Individual steps can also be run separately:
 *   pnpm step:01  - Initialize repository
 *   pnpm step:02  - Create files (blobs)
 *   pnpm step:03  - Build trees
 *   pnpm step:04  - Create commits
 *   pnpm step:05  - Update files
 *   pnpm step:06  - View history
 *   pnpm step:07  - Restore version
 *   pnpm step:08  - Branches and tags
 */

import { closeStorage, printSection, resetStorage } from "./shared/index.js";
import { step01InitRepository } from "./steps/01-init-repository.js";
import { step02CreateFiles } from "./steps/02-create-files.js";
import { step03BuildTrees } from "./steps/03-build-trees.js";
import { step04CreateCommits } from "./steps/04-create-commits.js";
import { step05UpdateFiles } from "./steps/05-update-files.js";
import { step06ViewHistory } from "./steps/06-view-history.js";
import { step07RestoreVersion } from "./steps/07-restore-version.js";
import { step08BranchesTags } from "./steps/08-branches-tags.js";

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║               webrun-vcs: Basic Git Cycle Example                            ║
║                                                                              ║
║  This example demonstrates the complete Git workflow using the webrun-vcs   ║
║  library. All operations use in-memory storage for demonstration.            ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  try {
    // Reset any previous state
    resetStorage();

    // Step 1: Initialize Repository
    printSection("Step 1: Initialize Repository");
    await step01InitRepository();

    // Step 2: Create Files (Blobs)
    printSection("Step 2: Create Files (Blobs)");
    await step02CreateFiles();

    // Step 3: Build Directory Structure (Trees)
    printSection("Step 3: Build Directory Structure (Trees)");
    await step03BuildTrees();

    // Step 4: Create Commits
    printSection("Step 4: Create Commits");
    await step04CreateCommits();

    // Step 5: Update Files (Add, Modify, Remove)
    printSection("Step 5: Update Files");
    await step05UpdateFiles();

    // Step 6: View Version History
    printSection("Step 6: View Version History");
    await step06ViewHistory();

    // Step 7: Restore Specific Version
    printSection("Step 7: Restore Specific Version");
    await step07RestoreVersion();

    // Step 8: Branches and Tags
    printSection("Step 8: Branches and Tags");
    await step08BranchesTags();

    // Cleanup
    await closeStorage();

    // Final summary
    printSection("Complete!");

    console.log(`
  All steps completed successfully.

  This example demonstrated:

    1. Repository Initialization
       - createGitRepository() creates .git directory structure
       - Returns Repository interface from @webrun-vcs/core
       - HEAD, refs/, objects/ directories are set up

    2. Blob Storage (Files) - High-Level BlobStore API
       - repository.blobs.store() creates content-addressable objects
       - Identical content = identical ID (deduplication)
       - repository.objects.getHeader() for metadata

    3. Tree Storage (Directories) - High-Level TreeStore API
       - repository.trees.storeTree() creates directory snapshots
       - Entries have mode (file type), name, and object ID

    4. Commit Creation - High-Level CommitStore API
       - repository.commits.storeCommit() links tree to history
       - Commits have parents, author, committer, message

    5. File Operations
       - Add: include new entries in tree
       - Modify: create new blob, update tree entry
       - Remove: create tree without that entry

    6. History Traversal
       - repository.commits.walkAncestry() traverses commit graph
       - Options for limiting depth, stopping at commits

    7. Version Restoration
       - Load tree from any commit to access files
       - Create "revert" commits to restore old state

    8. Branches and Tags - High-Level RefStore API
       - Branches: refs/heads/* pointing to commits
       - Tags: lightweight (ref) or annotated (object)
       - HEAD: symbolic ref to current branch

  For more details, see the README.md file.
`);
  } catch (error) {
    console.error("\nError:", error);
    process.exit(1);
  }
}

// Run the example
main();
