/**
 * Step 4: Traverse Commit History
 *
 * Walks through the last 1000 commits using webrun-vcs commit ancestry traversal.
 *
 * Run with: pnpm step:traverse
 */

import type { GitStorage } from "@webrun-vcs/storage-git";
import type { ObjectId } from "@webrun-vcs/vcs";
import {
  COMMIT_LIMIT,
  type CommitInfo,
  openStorage,
  PerformanceTracker,
  printBanner,
  printInfo,
  printSection,
  shortId,
} from "../shared/index.js";

export async function traverseCommits(
  storage: GitStorage,
  tracker?: PerformanceTracker,
): Promise<CommitInfo[]> {
  const perf = tracker ?? new PerformanceTracker();

  printSection("Step 4: Traverse Commit History");

  // Get HEAD reference - resolve follows symbolic refs to the commit
  const resolved = await storage.refs.resolve("HEAD");
  if (!resolved?.objectId) {
    throw new Error("HEAD reference not found or could not be resolved");
  }

  const headId: ObjectId = resolved.objectId;

  printInfo("HEAD commit", shortId(headId));
  console.log(`  Traversing last ${COMMIT_LIMIT} commits...\n`);

  const commits: CommitInfo[] = [];

  await perf.measureAsync(
    "commit_traversal",
    async () => {
      let count = 0;
      for await (const commitId of storage.commits.walkAncestry([headId], {
        limit: COMMIT_LIMIT,
      })) {
        const commit = await storage.commits.loadCommit(commitId);

        const firstLine = commit.message.split("\n")[0].substring(0, 60);
        const displayMessage =
          firstLine.length < commit.message.split("\n")[0].length ? `${firstLine}...` : firstLine;

        commits.push({
          id: commitId,
          shortId: shortId(commitId),
          message: displayMessage,
          author: commit.author.name,
          timestamp: commit.author.timestamp,
          parentCount: commit.parents.length,
        });

        count++;
        if (count % 100 === 0) {
          console.log(`  Processed ${count} commits...`);
        }
      }
    },
    { limit: COMMIT_LIMIT },
  );

  printInfo("Commits traversed", commits.length);

  // Show sample commits
  console.log("\n  Recent commits:");
  for (let i = 0; i < Math.min(10, commits.length); i++) {
    const c = commits[i];
    const date = new Date(c.timestamp * 1000).toISOString().split("T")[0];
    console.log(`    ${c.shortId} ${date} ${c.message}`);
  }

  if (commits.length > 10) {
    console.log(`    ... and ${commits.length - 10} more commits`);
  }

  return commits;
}

// Run as standalone script
if (import.meta.url === `file://${process.argv[1]}`) {
  printBanner("webrun-vcs: Traverse Commit History", "Step 4 of 6");
  openStorage()
    .then(async (storage) => {
      const commits = await traverseCommits(storage);
      console.log(`\n  Step 4 completed successfully!`);
      console.log(`  Traversed ${commits.length} commits.\n`);
      await storage.close();
    })
    .catch((error) => {
      console.error("\nError:", error);
      process.exit(1);
    });
}
