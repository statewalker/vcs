/**
 * Step 4: Create Commits
 *
 * This step demonstrates creating Git commit objects.
 *
 * Key concepts:
 * - Commits link a tree snapshot to history
 * - Commits have author, committer, message, and parent references
 * - Initial commits have no parents; subsequent commits reference parents
 * - Branch refs (refs/heads/xxx) point to the latest commit
 *
 * @see packages/storage/src/commit-storage.ts - CommitStorage interface
 * @see packages/storage-git/src/git-commit-storage.ts - Git implementation
 * @see packages/storage-git/src/format/commit-format.ts - Text format
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
import { FILES, storedFiles } from "./02-create-files.js";
import { storedTrees } from "./03-build-trees.js";

// Store commit IDs for use in later steps
export const storedCommits: Record<string, string> = {};

export async function step04CreateCommits(): Promise<void> {
  printStep(4, "Create Commits");

  const storage = await getStorage();

  // Ensure we have files and trees
  if (Object.keys(storedFiles).length === 0) {
    storedFiles.readme = await storeBlob(storage, FILES.readme);
    storedFiles.indexJs = await storeBlob(storage, FILES.indexJs);
    storedFiles.packageJson = await storeBlob(storage, FILES.packageJson);
  }
  if (!storedTrees.root1) {
    storedTrees.root1 = await storage.trees.storeTree([
      { mode: FileMode.REGULAR_FILE, name: "README.md", id: storedFiles.readme },
      { mode: FileMode.REGULAR_FILE, name: "index.js", id: storedFiles.indexJs },
      { mode: FileMode.REGULAR_FILE, name: "package.json", id: storedFiles.packageJson },
    ]);
  }

  printSubsection("Creating initial commit (no parents)");

  const author = createAuthor("Demo User", "demo@example.com", 0);

  // Create initial commit with storeCommit()
  storedCommits.commit1 = await storage.commits.storeCommit({
    tree: storedTrees.root1,
    parents: [], // Initial commit has no parents
    author,
    committer: author,
    message: "Initial commit\n\nAdd project structure with README, index.js, and package.json.",
  });

  console.log(`\n  Created initial commit: ${shortId(storedCommits.commit1)}`);
  console.log(`  Tree: ${shortId(storedTrees.root1)}`);
  console.log(`  Parents: (none - this is the initial commit)`);

  // Update branch reference
  await storage.refs.set("refs/heads/main", storedCommits.commit1);
  console.log(`\n  Updated refs/heads/main -> ${shortId(storedCommits.commit1)}`);

  printSubsection("Verifying commit");

  // Load commit back to verify
  const loaded = await storage.commits.loadCommit(storedCommits.commit1);
  console.log(`\n  Loaded commit:`);
  console.log(`    Tree:      ${shortId(loaded.tree)}`);
  console.log(`    Author:    ${loaded.author.name} <${loaded.author.email}>`);
  console.log(`    Timestamp: ${new Date(loaded.author.timestamp * 1000).toISOString()}`);
  console.log(`    Message:   ${loaded.message.split("\n")[0]}`);

  printSubsection("Creating second commit (with parent)");

  // Update README for second commit
  const readmeV2 = await storeBlob(
    storage,
    `# My Project

Welcome to my project! This is version 2 with updates.

## Features

- Feature A
- Feature B
- Feature C (NEW!)

## Getting Started

Run \`node index.js\` to start the application.
`,
  );
  storedFiles.readmeV2 = readmeV2;

  // Create new tree with updated file
  storedTrees.root1v2 = await storage.trees.storeTree([
    { mode: FileMode.REGULAR_FILE, name: "README.md", id: readmeV2 },
    { mode: FileMode.REGULAR_FILE, name: "index.js", id: storedFiles.indexJs },
    { mode: FileMode.REGULAR_FILE, name: "package.json", id: storedFiles.packageJson },
  ]);

  // Create second commit with parent reference
  storedCommits.commit2 = await storage.commits.storeCommit({
    tree: storedTrees.root1v2,
    parents: [storedCommits.commit1], // Reference to parent!
    author: createAuthor("Demo User", "demo@example.com", 1), // 1 hour later
    committer: createAuthor("Demo User", "demo@example.com", 1),
    message: "Update README with Feature C and getting started section",
  });

  await storage.refs.set("refs/heads/main", storedCommits.commit2);

  console.log(`\n  Created second commit: ${shortId(storedCommits.commit2)}`);
  console.log(`  Parent: ${shortId(storedCommits.commit1)}`);
  console.log(`  Updated refs/heads/main -> ${shortId(storedCommits.commit2)}`);

  printSubsection("HEAD resolution");

  // Show how HEAD resolves through the ref chain
  const _head = await storage.refs.get("HEAD");
  console.log(`\n  HEAD (symbolic ref): refs/heads/main`);

  const resolved = await storage.refs.resolve("HEAD");
  console.log(`  Resolved HEAD: ${shortId(resolved?.objectId ?? "")}`);

  const headId = await storage.getHead();
  console.log(`  storage.getHead(): ${shortId(headId ?? "")}`);

  const branch = await storage.getCurrentBranch();
  console.log(`  Current branch: ${branch}`);

  printSubsection("Commit graph structure");

  console.log(`\n  Commit chain (parent links):`);
  console.log(`    ${shortId(storedCommits.commit2)} <- HEAD (refs/heads/main)`);
  console.log(`    │`);
  console.log(`    └── parent: ${shortId(storedCommits.commit1)} (initial commit)`);
  console.log(`        │`);
  console.log(`        └── (no parent)`);

  console.log(`\n  Each commit points to:`);
  console.log(`    - A tree (snapshot of all files)`);
  console.log(`    - Parent commit(s) (history chain)`);
  console.log(`    - Author/committer info`);
  console.log(`    - Message`);
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 4: Create Commits");
  step04CreateCommits()
    .then(() => console.log("\n  Done!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
