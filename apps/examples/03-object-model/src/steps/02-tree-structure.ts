/**
 * Step 2: Tree Structure
 *
 * Demonstrates how Git represents directories using tree objects.
 * Trees contain entries with mode, name, and object reference.
 */

import {
  FileMode,
  getHistory,
  getModeString,
  getModeType,
  printSection,
  printStep,
  printSubsection,
  shortId,
  storeBlob,
} from "../shared.js";

export async function step02TreeStructure(): Promise<void> {
  printStep(2, "Tree Structure");

  const { history } = await getHistory();

  printSubsection("Creating files for the tree");

  const readmeId = await storeBlob(history, "# My Project\n\nA sample project.");
  const indexId = await storeBlob(history, 'console.log("Hello!");');
  const packageId = await storeBlob(history, '{ "name": "my-project" }');

  console.log(`\n  Created blobs:`);
  console.log(`    README.md:     ${shortId(readmeId)}`);
  console.log(`    index.js:      ${shortId(indexId)}`);
  console.log(`    package.json:  ${shortId(packageId)}`);

  printSubsection("Creating a tree");

  const treeId = await history.trees.store([
    { mode: FileMode.REGULAR_FILE, name: "README.md", id: readmeId },
    { mode: FileMode.REGULAR_FILE, name: "index.js", id: indexId },
    { mode: FileMode.REGULAR_FILE, name: "package.json", id: packageId },
  ]);

  console.log(`\n  Tree ID: ${shortId(treeId)}`);

  printSubsection("Reading tree entries");

  console.log(`\n  Tree entries (like 'git ls-tree'):`);
  const treeEntries = await history.trees.load(treeId);
  if (treeEntries) {
    for await (const entry of treeEntries) {
      const modeStr = getModeString(entry.mode);
      const typeStr = getModeType(entry.mode).padEnd(4);
      console.log(`    ${modeStr} ${typeStr} ${shortId(entry.id)}  ${entry.name}`);
    }
  }

  printSubsection("Nested directories");

  // Create a subdirectory
  const utilsId = await storeBlob(history, "export const add = (a, b) => a + b;");
  const srcTreeId = await history.trees.store([
    { mode: FileMode.REGULAR_FILE, name: "index.js", id: indexId },
    { mode: FileMode.REGULAR_FILE, name: "utils.js", id: utilsId },
  ]);

  // Create root tree with subdirectory
  const rootTreeId = await history.trees.store([
    { mode: FileMode.REGULAR_FILE, name: "README.md", id: readmeId },
    { mode: FileMode.REGULAR_FILE, name: "package.json", id: packageId },
    { mode: FileMode.TREE, name: "src", id: srcTreeId }, // Subdirectory!
  ]);

  console.log(`\n  Created nested structure:`);
  console.log(`    Root tree: ${shortId(rootTreeId)}`);
  console.log(`    src/ tree: ${shortId(srcTreeId)}`);

  console.log(`\n  Root tree entries:`);
  const rootTreeEntries = await history.trees.load(rootTreeId);
  if (rootTreeEntries) {
    for await (const entry of rootTreeEntries) {
      const modeStr = getModeString(entry.mode);
      const typeStr = getModeType(entry.mode).padEnd(4);
      console.log(`    ${modeStr} ${typeStr} ${shortId(entry.id)}  ${entry.name}`);
    }
  }

  printSubsection("Looking up specific entries");

  const entry = await history.trees.getEntry(rootTreeId, "README.md");
  console.log(`\n  Looking up "README.md":`);
  console.log(`    Found: ${entry !== undefined}`);
  if (entry) {
    console.log(`    ID: ${shortId(entry.id)}`);
    console.log(`    Mode: ${getModeString(entry.mode)}`);
  }

  printSubsection("File modes summary");

  console.log(`\n  Available file modes:`);
  console.log(`    ${getModeString(FileMode.TREE)}  - TREE (directory)`);
  console.log(`    ${getModeString(FileMode.REGULAR_FILE)}  - REGULAR_FILE`);
  console.log(`    ${getModeString(FileMode.EXECUTABLE_FILE)}  - EXECUTABLE_FILE`);
  console.log(`    ${getModeString(FileMode.SYMLINK)}  - SYMLINK`);
  console.log(`    ${getModeString(FileMode.GITLINK)}  - GITLINK (submodule)`);

  console.log("\nStep 2 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 2: Tree Structure");
  step02TreeStructure()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
