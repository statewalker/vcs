/**
 * Step 5: Update Files (Add, Modify, Remove)
 *
 * This step demonstrates the complete cycle of file modifications:
 * - Adding new files
 * - Modifying existing files
 * - Removing files
 *
 * Key concepts:
 * - Each modification creates new blobs/trees (immutable objects)
 * - Unchanged files are referenced by the same blob IDs (deduplication)
 * - File removal = creating a tree without that entry
 * - Each change is captured in a new commit
 *
 * @see packages/storage/src/file-tree-storage.ts - TreeEntry manipulation
 */

import {
  createAuthor,
  FileMode,
  getStorage,
  printSection,
  printStep,
  printSubsection,
  shortId,
  storeBlob,
} from "../shared/index.js";
import { storedFiles } from "./02-create-files.js";
import { storedTrees } from "./03-build-trees.js";
import { storedCommits } from "./04-create-commits.js";

export async function step05UpdateFiles(): Promise<void> {
  printStep(5, "Update Files (Add, Modify, Remove)");

  const storage = await getStorage();

  // Ensure previous steps have run
  if (!storedCommits.commit2) {
    console.log("  Note: Running steps 2-4 first to create initial commits...\n");
    const { step02CreateFiles } = await import("./02-create-files.js");
    const { step03BuildTrees } = await import("./03-build-trees.js");
    const { step04CreateCommits } = await import("./04-create-commits.js");
    await step02CreateFiles();
    await step03BuildTrees();
    await step04CreateCommits();
  }

  printSubsection("Adding new files");

  // Add test.js
  const testJs = await storeBlob(
    storage,
    `import { main } from "./index.js";

describe("main", () => {
  it("should log Hello World", () => {
    const spy = jest.spyOn(console, "log");
    main();
    expect(spy).toHaveBeenCalledWith("Hello, World!");
  });
});
`,
  );
  storedFiles.testJs = testJs;

  // Add src/utils.js
  const utilsJs = await storeBlob(
    storage,
    `// Utility functions
export function formatDate(date) {
  return date.toISOString();
}

export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
`,
  );
  storedFiles.utilsJs = utilsJs;

  console.log(`\n  Added new files:`);
  console.log(`    test.js:      ${shortId(testJs)}`);
  console.log(`    src/utils.js: ${shortId(utilsJs)}`);

  // Create src/ subtree
  storedTrees.srcTree = await storage.trees.storeTree([
    { mode: FileMode.REGULAR_FILE, name: "utils.js", id: utilsJs },
  ]);

  // Create new root tree with added files
  storedTrees.root3 = await storage.trees.storeTree([
    {
      mode: FileMode.REGULAR_FILE,
      name: "README.md",
      id: storedFiles.readmeV2 || storedFiles.readme,
    },
    { mode: FileMode.REGULAR_FILE, name: "index.js", id: storedFiles.indexJs },
    { mode: FileMode.REGULAR_FILE, name: "package.json", id: storedFiles.packageJson },
    { mode: FileMode.TREE, name: "src", id: storedTrees.srcTree },
    { mode: FileMode.REGULAR_FILE, name: "test.js", id: testJs },
  ]);

  console.log(`  New tree: ${shortId(storedTrees.root3)}`);

  // Create commit for added files
  storedCommits.commit3 = await storage.commits.storeCommit({
    tree: storedTrees.root3,
    parents: [storedCommits.commit2],
    author: createAuthor("Demo User", "demo@example.com", 2),
    committer: createAuthor("Demo User", "demo@example.com", 2),
    message:
      "Add tests and utility functions\n\n- Add test.js with basic test\n- Add src/utils.js with helpers",
  });

  await storage.refs.set("refs/heads/main", storedCommits.commit3);
  console.log(`  Created commit: ${shortId(storedCommits.commit3)}`);

  // Show tree contents
  console.log(`\n  Tree entries after adding files:`);
  for await (const entry of storage.trees.loadTree(storedTrees.root3)) {
    const type = entry.mode === FileMode.TREE ? "tree" : "blob";
    console.log(`    ${type.padEnd(4)} ${shortId(entry.id)}  ${entry.name}`);
  }

  printSubsection("Modifying existing files");

  // Update package.json version
  const packageJsonV2 = await storeBlob(
    storage,
    `{
  "name": "my-project",
  "version": "1.1.0",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "jest"
  }
}
`,
  );
  storedFiles.packageJsonV2 = packageJsonV2;

  console.log(`\n  Updated package.json:`);
  console.log(`    Old ID: ${shortId(storedFiles.packageJson)}`);
  console.log(`    New ID: ${shortId(packageJsonV2)}`);
  console.log(`    Different IDs because content changed`);

  // Create tree with modified file
  storedTrees.root4 = await storage.trees.storeTree([
    {
      mode: FileMode.REGULAR_FILE,
      name: "README.md",
      id: storedFiles.readmeV2 || storedFiles.readme,
    },
    { mode: FileMode.REGULAR_FILE, name: "index.js", id: storedFiles.indexJs }, // Unchanged!
    { mode: FileMode.REGULAR_FILE, name: "package.json", id: packageJsonV2 }, // Changed
    { mode: FileMode.TREE, name: "src", id: storedTrees.srcTree }, // Unchanged!
    { mode: FileMode.REGULAR_FILE, name: "test.js", id: storedFiles.testJs }, // Unchanged!
  ]);

  storedCommits.commit4 = await storage.commits.storeCommit({
    tree: storedTrees.root4,
    parents: [storedCommits.commit3],
    author: createAuthor("Demo User", "demo@example.com", 3),
    committer: createAuthor("Demo User", "demo@example.com", 3),
    message: "Update package.json version and add scripts",
  });

  await storage.refs.set("refs/heads/main", storedCommits.commit4);
  console.log(`\n  Created commit: ${shortId(storedCommits.commit4)}`);

  console.log(`\n  Note: Unchanged files keep the same blob ID:`);
  console.log(`    index.js uses ${shortId(storedFiles.indexJs)} in both commits`);
  console.log(`    This enables efficient storage through deduplication`);

  printSubsection("Removing files");

  // Create tree WITHOUT test.js (effectively deleting it)
  storedTrees.root5 = await storage.trees.storeTree([
    {
      mode: FileMode.REGULAR_FILE,
      name: "README.md",
      id: storedFiles.readmeV2 || storedFiles.readme,
    },
    { mode: FileMode.REGULAR_FILE, name: "index.js", id: storedFiles.indexJs },
    { mode: FileMode.REGULAR_FILE, name: "package.json", id: packageJsonV2 },
    { mode: FileMode.TREE, name: "src", id: storedTrees.srcTree },
    // test.js is NOT included = deleted!
  ]);

  console.log(`\n  To remove a file, create a tree without that entry`);
  console.log(`  New tree (without test.js): ${shortId(storedTrees.root5)}`);

  storedCommits.commit5 = await storage.commits.storeCommit({
    tree: storedTrees.root5,
    parents: [storedCommits.commit4],
    author: createAuthor("Demo User", "demo@example.com", 4),
    committer: createAuthor("Demo User", "demo@example.com", 4),
    message: "Remove test.js (tests moved to separate repo)",
  });

  await storage.refs.set("refs/heads/main", storedCommits.commit5);
  console.log(`  Created commit: ${shortId(storedCommits.commit5)}`);

  // Show final tree
  console.log(`\n  Tree entries after removing test.js:`);
  for await (const entry of storage.trees.loadTree(storedTrees.root5)) {
    const type = entry.mode === FileMode.TREE ? "tree" : "blob";
    console.log(`    ${type.padEnd(4)} ${shortId(entry.id)}  ${entry.name}`);
  }

  printSubsection("Commit history so far");

  console.log(`\n  Commits created in this example:`);
  console.log(`    1. ${shortId(storedCommits.commit1)} - Initial commit`);
  console.log(`    2. ${shortId(storedCommits.commit2)} - Update README`);
  console.log(`    3. ${shortId(storedCommits.commit3)} - Add tests and utilities`);
  console.log(`    4. ${shortId(storedCommits.commit4)} - Update package.json`);
  console.log(`    5. ${shortId(storedCommits.commit5)} - Remove test.js <- HEAD`);
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 5: Update Files (Add, Modify, Remove)");
  step05UpdateFiles()
    .then(() => console.log("\n  Done!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
