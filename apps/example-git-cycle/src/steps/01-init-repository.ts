/**
 * Step 1: Initialize Repository
 *
 * This step demonstrates how to create a new Git repository using statewalker-vcs.
 *
 * Key concepts:
 * - GitStorage.init() creates the repository directory structure
 * - HEAD is initialized as a symbolic reference to the default branch
 * - The objects/ and refs/ directories are created for storage
 *
 * @see packages/storage-git/src/git-storage.ts - GitStorage.init()
 * @see packages/storage-git/src/refs/ref-writer.ts - Reference initialization
 */

import {
  GIT_DIR,
  getFilesApi,
  getStorage,
  initCompression,
  printSection,
  printStep,
} from "../shared/index.js";

export async function step01InitRepository(): Promise<void> {
  printStep(1, "Initialize Repository");

  // Initialize compression (required before any storage operations)
  initCompression();

  // Get or create the storage instance
  // This calls GitStorage.init() internally if the repository doesn't exist
  const storage = await getStorage();
  const files = getFilesApi();

  console.log(`\n  Repository initialized at: ${GIT_DIR}`);
  console.log(`  Default branch: ${await storage.getCurrentBranch()}`);

  // Verify directory structure was created
  console.log(`\n  Verifying directory structure:`);

  const structure = [
    { path: `${GIT_DIR}/HEAD`, desc: "HEAD file (symbolic ref to current branch)" },
    { path: `${GIT_DIR}/config`, desc: "Repository configuration" },
    { path: `${GIT_DIR}/objects`, desc: "Object database directory" },
    { path: `${GIT_DIR}/refs/heads`, desc: "Branch references directory" },
    { path: `${GIT_DIR}/refs/tags`, desc: "Tag references directory" },
  ];

  for (const item of structure) {
    const exists = await files.exists(item.path);
    const status = exists ? "✓" : "✗";
    console.log(`    ${status} ${item.path.replace(`${GIT_DIR}/`, "")}`);
    console.log(`      ${item.desc}`);
  }

  // Read HEAD content to show symbolic reference
  const headContent = await files.readFile(`${GIT_DIR}/HEAD`);
  const headText = new TextDecoder().decode(headContent);
  console.log(`\n  HEAD content: ${headText.trim()}`);
  console.log(`  This is a symbolic reference pointing to refs/heads/main`);

  // Demonstrate opening an existing repository
  console.log(`\n  Note: Calling getStorage() again reuses the existing repository`);
  const storage2 = await getStorage();
  console.log(`  Same instance: ${storage === storage2}`);
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 1: Initialize Repository");
  step01InitRepository()
    .then(() => console.log("\n  Done!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
