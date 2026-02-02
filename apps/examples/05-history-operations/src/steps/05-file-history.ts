/**
 * Step 5: File History
 *
 * Demonstrates tracking file history through commits.
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

export async function step05FileHistory(): Promise<void> {
  printStep(5, "File History");

  await resetState();
  const { git, workingCopy, history } = await getGit();

  // Create a file with rich history
  console.log("\n--- Creating file with history ---");

  // Create initial file
  await addFileToStaging(
    workingCopy,
    "src/main.ts",
    `// Main entry point
console.log("v1");
`,
  );
  await git.commit().setMessage("Create main.ts").call();
  console.log("  Commit 1: Create main.ts");

  // Add another file (won't affect main.ts history)
  await addFileToStaging(workingCopy, "src/utils.ts", "export const utils = {};");
  await git.commit().setMessage("Add utils.ts").call();
  console.log("  Commit 2: Add utils.ts");

  // Modify main.ts
  await addFileToStaging(
    workingCopy,
    "src/main.ts",
    `// Main entry point
import { utils } from "./utils";
console.log("v2");
`,
  );
  await git.commit().setMessage("Update main.ts with import").call();
  console.log("  Commit 3: Update main.ts with import");

  // Another unrelated change
  await addFileToStaging(workingCopy, "README.md", "# Project");
  await git.commit().setMessage("Add README").call();
  console.log("  Commit 4: Add README");

  // More changes to main.ts
  await addFileToStaging(
    workingCopy,
    "src/main.ts",
    `// Main entry point
import { utils } from "./utils";
import { config } from "./config";
console.log("v3");
`,
  );
  await git.commit().setMessage("Add config import to main.ts").call();
  console.log("  Commit 5: Add config import to main.ts");

  // Track file history manually
  console.log("\n--- Tracking src/main.ts history ---");
  console.log("\nWalking commits and checking for file changes:");

  const fileHistory: Array<{
    commitId: string;
    message: string;
    date: string;
    blobId: string;
  }> = [];

  const head = await history.refs.resolve("HEAD");
  if (!head?.objectId) {
    console.log("  No commits found");
    return;
  }

  let previousBlobId: string | undefined;

  // Walk all commits
  for await (const commitId of history.commits.walkAncestry(head.objectId)) {
    const commit = await history.commits.load(commitId);
    if (!commit) continue;

    // Check if file exists and get its blob
    const blobId = await getFileBlobId(history, commit.tree, "src/main.ts");

    if (blobId && blobId !== previousBlobId) {
      // File exists and changed (or is new)
      fileHistory.push({
        commitId,
        message: commit.message.split("\n")[0],
        date: formatDate(commit.author.timestamp),
        blobId,
      });
      previousBlobId = blobId;
    }
  }

  // Display file history
  console.log(`\n  Found ${fileHistory.length} commits affecting src/main.ts:\n`);

  for (const entry of fileHistory) {
    console.log(`  ${shortId(entry.commitId)} | ${entry.date} | ${entry.message}`);
  }

  // Show version comparison
  console.log("\n--- Comparing file versions ---");

  if (fileHistory.length >= 2) {
    const latest = fileHistory[0];
    const earliest = fileHistory[fileHistory.length - 1];

    console.log(`\n  Earliest version (${shortId(earliest.commitId)}):`);
    const earliestContent = await collectBlob(history, earliest.blobId);
    console.log(`  ${new TextDecoder().decode(earliestContent).split("\n").join("\n  ")}`);

    console.log(`\n  Latest version (${shortId(latest.commitId)}):`);
    const latestContent = await collectBlob(history, latest.blobId);
    console.log(`  ${new TextDecoder().decode(latestContent).split("\n").join("\n  ")}`);
  }

  // Explain file tracking approaches
  console.log("\n--- File history approaches ---");
  console.log(`
  1. Manual walk (shown above):
     - Walk all commits
     - Check if file exists and changed
     - Collect matching commits

  2. Using git log with path filter (when available):
     - git.log().addPath("src/main.ts").call()
     - More efficient for large repositories

  3. Using blame:
     - git.blame().setFilePath(path).call()
     - Shows which commit introduced each line

  4. Rename tracking:
     - Follow file across renames
     - git.blame().setFollowRenames(true).call()
  `);

  console.log("\n--- Use cases ---");
  console.log(`
  - Debugging: "When did this line change?"
  - Auditing: "Who modified this file?"
  - Recovery: "What was the old version?"
  - Understanding: "Why was this changed?"
  `);

  console.log("\nStep 5 completed!");
}

// Helper: Get blob ID for a file in a tree
async function getFileBlobId(
  history: Awaited<ReturnType<typeof getGit>>["history"],
  treeId: string,
  path: string,
): Promise<string | undefined> {
  const parts = path.split("/").filter((p) => p.length > 0);
  let currentTreeId = treeId;

  for (let i = 0; i < parts.length; i++) {
    const name = parts[i];
    const isLast = i === parts.length - 1;

    try {
      const entry = await history.trees.getEntry(currentTreeId, name);
      if (!entry) return undefined;

      if (isLast) return entry.id;
      currentTreeId = entry.id;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

// Helper: Collect blob content
async function collectBlob(
  history: Awaited<ReturnType<typeof getGit>>["history"],
  blobId: string,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const content = await history.blobs.load(blobId);
  if (content) {
    for await (const chunk of content) {
      chunks.push(chunk);
    }
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
  printSection("Step 5: File History");
  step05FileHistory()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
