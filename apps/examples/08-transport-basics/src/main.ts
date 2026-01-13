/**
 * Example 08: Transport Basics
 *
 * This example demonstrates Git transport operations:
 * - Listing remote refs (ls-remote)
 * - Cloning a repository
 * - Fetching updates
 *
 * These operations use the Git HTTP smart protocol to communicate
 * with remote Git servers like GitHub.
 */

import {
  type CloneResult,
  checkRemote,
  clone,
  fetch,
  fetchRefs,
  lsRemote,
} from "@statewalker/vcs-transport";
import { bytesToHex } from "@statewalker/vcs-utils/hash/utils";

// Use a small public repository for demonstration
const REPO_URL = "https://github.com/octocat/Hello-World.git";

/**
 * Demonstrate ls-remote operation.
 *
 * ls-remote shows all refs in a remote repository without
 * downloading any objects. Useful for checking what branches
 * and tags exist.
 */
async function demonstrateLsRemote(): Promise<void> {
  console.log("=== ls-remote: List Remote Refs ===\n");

  const refs = await lsRemote(REPO_URL);

  console.log(`Repository: ${REPO_URL}`);
  console.log(`Found ${refs.size} refs:\n`);

  // Group refs by type
  const heads: Array<[string, string]> = [];
  const tags: Array<[string, string]> = [];
  const other: Array<[string, string]> = [];

  for (const [name, id] of refs) {
    if (name.startsWith("refs/heads/")) {
      heads.push([name.replace("refs/heads/", ""), id]);
    } else if (name.startsWith("refs/tags/")) {
      tags.push([name.replace("refs/tags/", ""), id]);
    } else {
      other.push([name, id]);
    }
  }

  if (heads.length > 0) {
    console.log("Branches:");
    for (const [name, id] of heads) {
      console.log(`  ${name.padEnd(30)} ${id.slice(0, 8)}`);
    }
    console.log();
  }

  if (tags.length > 0) {
    console.log("Tags:");
    for (const [name, id] of tags) {
      console.log(`  ${name.padEnd(30)} ${id.slice(0, 8)}`);
    }
    console.log();
  }

  if (other.length > 0) {
    console.log("Other:");
    for (const [name, id] of other) {
      console.log(`  ${name.padEnd(30)} ${id.slice(0, 8)}`);
    }
    console.log();
  }
}

/**
 * Demonstrate checking if a remote is accessible.
 */
async function demonstrateCheckRemote(): Promise<void> {
  console.log("=== checkRemote: Verify Repository Access ===\n");

  // Check the public repository
  console.log(`Checking: ${REPO_URL}`);
  const publicResult = await checkRemote(REPO_URL);
  console.log(`  Exists: ${publicResult.exists}`);
  console.log(`  Empty: ${publicResult.isEmpty}`);
  console.log(`  Default branch: ${publicResult.defaultBranch || "unknown"}`);
  console.log();

  // Check a non-existent repository
  const nonExistentUrl = "https://github.com/nonexistent-user-12345/nonexistent-repo.git";
  console.log(`Checking: ${nonExistentUrl}`);
  const notFoundResult = await checkRemote(nonExistentUrl);
  console.log(`  Exists: ${notFoundResult.exists}`);
  console.log(`  Error: ${notFoundResult.error || "none"}`);
  console.log();
}

/**
 * Demonstrate fetch refs operation.
 *
 * fetchRefs gets the full ref advertisement including
 * capabilities and symbolic refs.
 */
async function demonstrateFetchRefs(): Promise<void> {
  console.log("=== fetchRefs: Get Full Ref Advertisement ===\n");

  const advertisement = await fetchRefs(REPO_URL);

  console.log(`Capabilities: ${[...advertisement.capabilities].join(", ")}`);
  console.log(`Agent: ${advertisement.agent || "unknown"}`);
  console.log();

  if (advertisement.symrefs.size > 0) {
    console.log("Symbolic refs:");
    for (const [name, target] of advertisement.symrefs) {
      console.log(`  ${name} -> ${target}`);
    }
    console.log();
  }

  console.log(`Refs (${advertisement.refs.size}):`);
  for (const [name, id] of advertisement.refs) {
    console.log(`  ${name.padEnd(40)} ${bytesToHex(id).slice(0, 8)}`);
  }
  console.log();
}

/**
 * Demonstrate clone operation.
 *
 * Clone fetches all objects and refs from a remote repository.
 * The pack data can then be stored locally.
 */
async function demonstrateClone(): Promise<CloneResult> {
  console.log("=== clone: Download Repository ===\n");

  console.log(`Cloning: ${REPO_URL}`);
  console.log();

  const result = await clone({
    url: REPO_URL,
    onProgress: (info) => {
      const percent = info.total ? Math.round((info.current / info.total) * 100) : undefined;
      const percentStr = percent !== undefined ? ` (${percent}%)` : "";
      console.log(
        `  ${info.stage}: ${info.current}${info.total ? `/${info.total}` : ""}${percentStr}`,
      );
    },
    onProgressMessage: (message) => {
      // Show raw server messages
      const trimmed = message.trim();
      if (trimmed) {
        console.log(`  Server: ${trimmed}`);
      }
    },
  });

  console.log();
  console.log("Clone complete:");
  console.log(`  Default branch: ${result.defaultBranch}`);
  console.log(`  Refs fetched: ${result.refs.size}`);
  console.log(`  Pack size: ${formatBytes(result.packData.length)}`);
  console.log(`  Bytes received: ${formatBytes(result.bytesReceived)}`);
  console.log(`  Empty: ${result.isEmpty}`);
  console.log();

  console.log("Fetched refs:");
  for (const [name, id] of result.refs) {
    console.log(`  ${name.padEnd(50)} ${bytesToHex(id).slice(0, 8)}`);
  }
  console.log();

  return result;
}

/**
 * Demonstrate fetch operation.
 *
 * Fetch updates local refs from a remote. It uses negotiation
 * to minimize data transfer.
 */
async function demonstrateFetch(): Promise<void> {
  console.log("=== fetch: Update from Remote ===\n");

  console.log(`Fetching from: ${REPO_URL}`);
  console.log("Using refspec: +refs/heads/*:refs/remotes/origin/*");
  console.log();

  const result = await fetch({
    url: REPO_URL,
    refspecs: ["+refs/heads/*:refs/remotes/origin/*", "+refs/tags/*:refs/tags/*"],
    onProgress: (info) => {
      const percent = info.total ? Math.round((info.current / info.total) * 100) : undefined;
      const percentStr = percent !== undefined ? ` (${percent}%)` : "";
      console.log(
        `  ${info.stage}: ${info.current}${info.total ? `/${info.total}` : ""}${percentStr}`,
      );
    },
  });

  console.log();
  console.log("Fetch complete:");
  console.log(`  Default branch: ${result.defaultBranch || "unknown"}`);
  console.log(`  Refs updated: ${result.refs.size}`);
  console.log(`  Pack size: ${formatBytes(result.packData.length)}`);
  console.log(`  Empty: ${result.isEmpty}`);
  console.log();

  if (result.refs.size > 0) {
    console.log("Updated refs:");
    for (const [name, id] of result.refs) {
      console.log(`  ${name.padEnd(50)} ${bytesToHex(id).slice(0, 8)}`);
    }
    console.log();
  }
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Run a demonstration step with error handling.
 */
async function runStep(name: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (error) {
    console.log(`[!] ${name} failed: ${error instanceof Error ? error.message : error}`);
    console.log("    (This may be a network or transport layer issue)\n");
    return false;
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║          Example 08: Transport Basics                          ║");
  console.log("║                                                                ║");
  console.log("║  Clone, fetch, and push operations using Git HTTP protocol    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  console.log("NOTE: This example requires network access to GitHub.\n");

  let successCount = 0;
  const totalSteps = 5;

  // 1. Check if repository is accessible
  if (await runStep("checkRemote", demonstrateCheckRemote)) successCount++;

  // 2. List remote refs
  if (await runStep("ls-remote", demonstrateLsRemote)) successCount++;

  // 3. Get full ref advertisement
  if (await runStep("fetchRefs", demonstrateFetchRefs)) successCount++;

  // 4. Clone the repository
  if (
    await runStep("clone", async () => {
      await demonstrateClone();
    })
  )
    successCount++;

  // 5. Fetch updates (simulating incremental update)
  if (await runStep("fetch", demonstrateFetch)) successCount++;

  console.log("═══════════════════════════════════════════════════════════════");
  if (successCount === totalSteps) {
    console.log("Example complete! All transport operations succeeded.");
  } else {
    console.log(`Example finished with ${successCount}/${totalSteps} operations successful.`);
    console.log("Some operations failed - this may indicate transport layer issues");
    console.log("or network connectivity problems.");
  }
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Don't exit with error - the example demonstrates the API even if network fails
}

main();
