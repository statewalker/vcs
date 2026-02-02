/**
 * Main Entry Point: Object Model Example
 *
 * This script runs all steps demonstrating Git's internal object model.
 *
 * Run with: pnpm start
 *
 * Individual steps can also be run separately:
 *   pnpm step:01  - Blob storage
 *   pnpm step:02  - Tree structure
 *   pnpm step:03  - Commit anatomy
 *   pnpm step:04  - Tags
 *   pnpm step:05  - Deduplication
 */

import { printSection, resetState } from "./shared.js";
import { step01BlobStorage } from "./steps/01-blob-storage.js";
import { step02TreeStructure } from "./steps/02-tree-structure.js";
import { step03CommitAnatomy } from "./steps/03-commit-anatomy.js";
import { step04Tags } from "./steps/04-tags.js";
import { step05Deduplication } from "./steps/05-deduplication.js";

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║               statewalker-vcs: Git Object Model Example                      ║
║                                                                              ║
║  This example explores Git's internal object model to understand how         ║
║  version control works at a fundamental level.                               ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  try {
    // Reset any previous state
    await resetState();

    // Step 1: Blob Storage
    printSection("Step 1: Blob Storage");
    await step01BlobStorage();

    // Step 2: Tree Structure
    printSection("Step 2: Tree Structure");
    await step02TreeStructure();

    // Step 3: Commit Anatomy
    printSection("Step 3: Commit Anatomy");
    await step03CommitAnatomy();

    // Step 4: Tags
    printSection("Step 4: Tags");
    await step04Tags();

    // Step 5: Deduplication
    printSection("Step 5: Deduplication");
    await step05Deduplication();

    // Final summary
    printSection("Complete!");

    console.log(`
  All steps completed successfully.

  This example demonstrated Git's internal object model:

    1. Blob Storage
       - Blobs store file content
       - Content is hashed with SHA-1 to produce object ID
       - Objects are stored in .git/objects/{xx}/{rest}

    2. Tree Structure
       - Trees represent directory snapshots
       - Each entry has mode, name, and object ID
       - Trees can reference other trees (subdirectories)
       - File modes: TREE, REGULAR_FILE, EXECUTABLE, SYMLINK, GITLINK

    3. Commit Anatomy
       - Commits link a tree to history
       - Components: tree, parents, author, committer, message
       - Parents create the commit graph
       - Initial commits have no parents

    4. Tags
       - Lightweight: simple refs pointing to commits
       - Annotated: actual objects with metadata
       - Annotated tags have tagger, message, can be signed

    5. Deduplication
       - Same content = same hash = stored once
       - Automatic deduplication across entire repository
       - Enables efficient storage and comparison

  Key insight: Git's object model is simple yet powerful.
  Everything is content-addressable, enabling integrity,
  deduplication, and efficient storage.

  For more details, see the README.md file.
`);
  } catch (error) {
    console.error("\nError:", error);
    process.exit(1);
  }
}

// Run the example
main();
