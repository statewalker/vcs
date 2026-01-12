/**
 * Step 4: Blame
 *
 * Demonstrates line-by-line attribution with git blame.
 */

import {
  addFileToStaging,
  formatDate,
  getGit,
  printSection,
  printStep,
  resetState,
  shortId,
} from "../shared.js";

export async function step04Blame(): Promise<void> {
  printStep(4, "Blame");

  resetState();
  const { git, store } = await getGit();

  // Create a file with history from multiple commits
  console.log("\n--- Creating file with history ---");

  // First version
  await addFileToStaging(
    store,
    "src/config.ts",
    `// Configuration file
export const config = {
  name: "MyApp",
  version: "1.0.0",
};
`,
  );
  await git.commit().setMessage("Initial config file").call();
  console.log("  Commit 1: Initial config file");

  // Second version - add debug flag
  await addFileToStaging(
    store,
    "src/config.ts",
    `// Configuration file
export const config = {
  name: "MyApp",
  version: "1.0.0",
  debug: false,
};
`,
  );
  await git.commit().setMessage("Add debug flag").call();
  console.log("  Commit 2: Add debug flag");

  // Third version - update version and add feature
  await addFileToStaging(
    store,
    "src/config.ts",
    `// Configuration file
// Updated for v2
export const config = {
  name: "MyApp",
  version: "2.0.0",
  debug: false,
  features: ["auth", "api"],
};
`,
  );
  await git.commit().setMessage("Update to v2 with features").call();
  console.log("  Commit 3: Update to v2 with features");

  // Run blame
  console.log("\n--- Running git blame ---");

  const result = await git.blame().setFilePath("src/config.ts").call();

  console.log(`\n  File: ${result.path}`);
  console.log(`  Lines: ${result.lineCount}`);
  console.log(`  Entries: ${result.entries.length}`);

  // Display blame output
  console.log("\n--- Blame output ---\n");
  console.log("  Line | Commit  | Author        | Content");
  console.log(`  ${"-".repeat(60)}`);

  // Get line tracking for detailed output
  const lineTracking = result.getLineTracking();

  // Read file content to show alongside blame
  const head = await store.refs.resolve("HEAD");
  if (head?.objectId) {
    const commit = await store.commits.loadCommit(head.objectId);
    const blobId = await getFileBlobId(store, commit.tree, "src/config.ts");
    if (blobId) {
      const content = await collectBlob(store, blobId);
      const lines = new TextDecoder().decode(content).split("\n");

      for (let i = 0; i < lines.length && i < lineTracking.length; i++) {
        const tracking = lineTracking[i];
        const line = lines[i];
        const authorName = tracking.commit.author.name.slice(0, 12).padEnd(12);
        console.log(
          `  ${String(i + 1).padStart(4)} | ${shortId(tracking.commitId)} | ${authorName} | ${line}`,
        );
      }
    }
  }

  // Show blame entry details
  console.log("\n--- Blame entries (grouped by commit) ---");

  for (const entry of result.entries) {
    console.log(`\n  Commit: ${shortId(entry.commitId)}`);
    console.log(`    Author: ${entry.commit.author.name}`);
    console.log(`    Date: ${formatDate(entry.commit.author.timestamp)}`);
    console.log(`    Message: ${entry.commit.message.split("\n")[0]}`);
    console.log(`    Lines: ${entry.resultStart}-${entry.resultStart + entry.lineCount - 1}`);
  }

  // Demonstrate blame API methods
  console.log("\n--- Blame API methods ---");

  // Get author of specific line
  const line5Author = result.getSourceAuthor(5);
  console.log(`\n  Line 5 author: ${line5Author?.name || "unknown"}`);

  // Get commit that introduced line
  const line5Commit = result.getSourceCommit(5);
  console.log(`  Line 5 commit: ${line5Commit?.message.split("\n")[0] || "unknown"}`);

  // Get source line number (useful for tracking through history)
  const line5Source = result.getSourceLine(5);
  console.log(`  Line 5 source line: ${line5Source || "unknown"}`);

  console.log("\n--- Blame API Summary ---");
  console.log(`
  git.blame()                  - Start blame command
    .setFilePath(path)         - File to blame (required)
    .setStartCommit(id)        - Start from specific commit
    .setFollowRenames(bool)    - Follow file renames
    .call()                    - Execute and return BlameResult

  BlameResult methods:
    .entries                   - Array of BlameEntry
    .getEntry(line)            - Get entry for line (1-based)
    .getSourceCommit(line)     - Get commit that introduced line
    .getSourceAuthor(line)     - Get author of line
    .getSourceLine(line)       - Get original line number
    .getLineTracking()         - Get detailed tracking for all lines
  `);

  console.log("\nStep 4 completed!");
}

// Helper: Get blob ID for a file in a tree
async function getFileBlobId(
  store: Awaited<ReturnType<typeof getGit>>["store"],
  treeId: string,
  path: string,
): Promise<string | undefined> {
  const parts = path.split("/").filter((p) => p.length > 0);
  let currentTreeId = treeId;

  for (let i = 0; i < parts.length; i++) {
    const name = parts[i];
    const isLast = i === parts.length - 1;

    const entry = await store.trees.getEntry(currentTreeId, name);
    if (!entry) return undefined;

    if (isLast) return entry.id;
    currentTreeId = entry.id;
  }

  return undefined;
}

// Helper: Collect blob content
async function collectBlob(
  store: Awaited<ReturnType<typeof getGit>>["store"],
  blobId: string,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of store.blobs.load(blobId)) {
    chunks.push(chunk);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 4: Blame");
  step04Blame()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
