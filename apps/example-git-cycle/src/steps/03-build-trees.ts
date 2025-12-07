/**
 * Step 3: Build Directory Structure (Trees)
 *
 * This step demonstrates creating Git tree objects that represent directories.
 *
 * Key concepts:
 * - Trees contain entries with mode, name, and object ID
 * - Entries can reference blobs (files) or other trees (subdirectories)
 * - Trees are automatically sorted in Git canonical order
 * - File modes indicate type: regular file, executable, symlink, tree, gitlink
 *
 * @see packages/storage/src/file-tree-storage.ts - FileTreeStorage interface
 * @see packages/storage-git/src/git-file-tree-storage.ts - Git implementation
 * @see packages/storage-git/src/format/tree-format.ts - Binary format
 */

import {
  FileMode,
  getModeString,
  getModeType,
  getStorage,
  printSection,
  printStep,
  printSubsection,
  shortId,
  storeBlob,
} from "../shared/index.js";
import { FILES, storedFiles } from "./02-create-files.js";

// Store tree IDs for use in later steps
export const storedTrees: Record<string, string> = {};

export async function step03BuildTrees(): Promise<void> {
  printStep(3, "Build Directory Structure (Trees)");

  const storage = await getStorage();

  // Ensure blobs exist
  if (Object.keys(storedFiles).length === 0) {
    storedFiles.readme = await storeBlob(storage, FILES.readme);
    storedFiles.indexJs = await storeBlob(storage, FILES.indexJs);
    storedFiles.packageJson = await storeBlob(storage, FILES.packageJson);
  }

  printSubsection("Creating root tree");

  // Create root tree with initial files
  // storeTree() accepts an array (or AsyncIterable) of TreeEntry objects
  storedTrees.root1 = await storage.trees.storeTree([
    { mode: FileMode.REGULAR_FILE, name: "README.md", id: storedFiles.readme },
    { mode: FileMode.REGULAR_FILE, name: "index.js", id: storedFiles.indexJs },
    { mode: FileMode.REGULAR_FILE, name: "package.json", id: storedFiles.packageJson },
  ]);

  console.log(`\n  Created root tree: ${shortId(storedTrees.root1)}`);

  // Show tree entries
  console.log(`\n  Tree entries (automatically sorted):`);
  for await (const entry of storage.trees.loadTree(storedTrees.root1)) {
    const modeStr = getModeString(entry.mode);
    const typeStr = getModeType(entry.mode);
    console.log(`    ${modeStr} ${typeStr} ${shortId(entry.id)}  ${entry.name}`);
  }

  printSubsection("Creating nested directory structure");

  // Create a subdirectory (src/)
  const utilsContent = `// Utility functions
export function formatDate(date) {
  return date.toISOString();
}
`;
  storedFiles.utils = await storeBlob(storage, utilsContent);

  storedTrees.src = await storage.trees.storeTree([
    { mode: FileMode.REGULAR_FILE, name: "utils.js", id: storedFiles.utils },
  ]);

  console.log(`\n  Created src/ tree: ${shortId(storedTrees.src)}`);

  // Create root tree with subdirectory
  storedTrees.root2 = await storage.trees.storeTree([
    { mode: FileMode.REGULAR_FILE, name: "README.md", id: storedFiles.readme },
    { mode: FileMode.REGULAR_FILE, name: "index.js", id: storedFiles.indexJs },
    { mode: FileMode.REGULAR_FILE, name: "package.json", id: storedFiles.packageJson },
    { mode: FileMode.TREE, name: "src", id: storedTrees.src }, // Subdirectory!
  ]);

  console.log(`  Created root tree with src/: ${shortId(storedTrees.root2)}`);

  // Show the tree structure
  console.log(`\n  Tree entries with subdirectory:`);
  for await (const entry of storage.trees.loadTree(storedTrees.root2)) {
    const modeStr = getModeString(entry.mode);
    const typeStr = getModeType(entry.mode).padEnd(4);
    console.log(`    ${modeStr} ${typeStr} ${shortId(entry.id)}  ${entry.name}`);
  }

  printSubsection("Getting specific entry");

  // Demonstrate getEntry() for quick lookups
  const entry = await storage.trees.getEntry(storedTrees.root1, "README.md");
  console.log(`\n  Looking up "README.md" in tree:`);
  console.log(`    Found: ${entry !== undefined}`);
  console.log(`    ID:    ${entry ? shortId(entry.id) : "N/A"}`);
  console.log(`    Mode:  ${entry ? getModeString(entry.mode) : "N/A"}`);

  const missing = await storage.trees.getEntry(storedTrees.root1, "missing.txt");
  console.log(`\n  Looking up "missing.txt":`);
  console.log(`    Found: ${missing !== undefined}`);

  printSubsection("Empty tree");

  // Git has a well-known empty tree ID
  const emptyTreeId = storage.trees.getEmptyTreeId();
  console.log(`\n  Empty tree ID: ${emptyTreeId}`);
  console.log(`  This is a well-known constant in Git.`);

  let emptyCount = 0;
  for await (const _ of storage.trees.loadTree(emptyTreeId)) {
    emptyCount++;
  }
  console.log(`  Entries in empty tree: ${emptyCount}`);

  printSubsection("File modes summary");

  console.log(`\n  Available file modes:`);
  console.log(`    ${getModeString(FileMode.TREE)}  - TREE (directory)`);
  console.log(`    ${getModeString(FileMode.REGULAR_FILE)}  - REGULAR_FILE (non-executable)`);
  console.log(`    ${getModeString(FileMode.EXECUTABLE_FILE)}  - EXECUTABLE_FILE`);
  console.log(`    ${getModeString(FileMode.SYMLINK)}  - SYMLINK`);
  console.log(`    ${getModeString(FileMode.GITLINK)}  - GITLINK (submodule)`);
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 3: Build Directory Structure (Trees)");
  step03BuildTrees()
    .then(() => console.log("\n  Done!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
