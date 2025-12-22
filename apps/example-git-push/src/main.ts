/**
 * Example demonstrating the complete clone/branch/commit/push workflow.
 *
 * This example:
 * 1. Creates a bare git repository
 * 2. Creates an initial commit using native git
 * 3. Starts an HTTP server exposing the repository
 * 4. Clones the repository using native git (for simplicity)
 * 5. Opens the repository with VCS
 * 6. Creates a new branch using VCS
 * 7. Makes changes and creates a commit using VCS
 * 8. Pushes the branch back to the remote using VCS transport
 * 9. Verifies the push using native git
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FilesApi, NodeFilesApi } from "@statewalker/webrun-files";
import {
  createGitStorage,
  extractGitObjectContent,
  type GitStorage,
  parseObjectHeader,
} from "@webrun-vcs/storage-git";
import { type PushObject, push } from "@webrun-vcs/transport";
import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { FileMode } from "@webrun-vcs/vcs";

import {
  BASE_DIR,
  createAuthor,
  createGitHttpServer,
  DEFAULT_BRANCH,
  ensureDirectory,
  fixGitObjectPermissions,
  type GitHttpServer,
  HTTP_PORT,
  LOCAL_REPO_DIR,
  printError,
  printInfo,
  printSection,
  printStep,
  printSuccess,
  REMOTE_REPO_DIR,
  REMOTE_URL,
  removeDirectory,
  runGit,
  runGitAsync,
  runGitSafeAsync,
  shortId,
  TEST_BRANCH,
} from "./shared/index.js";

// Initialize compression
setCompression(createNodeCompression());

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  printSection("VCS Push Example");
  console.log("This example demonstrates creating branches, commits, and pushing");
  console.log("using the VCS library with a native git HTTP server.\n");

  let server: GitHttpServer | null = null;

  try {
    // Step 1: Setup - Create bare repository and initial commit
    printStep(1, "Setting up remote repository");
    await setupRemoteRepository();

    // Step 2: Start HTTP server
    printStep(2, "Starting HTTP server");
    server = await startHttpServer();

    // Step 3: Clone repository using native git
    printStep(3, "Cloning repository (native git)");
    await cloneWithNativeGit();

    // Step 4: Open repository with VCS
    printStep(4, "Opening repository with VCS");
    const storage = await openRepositoryWithVcs();

    // Step 5: Create new branch
    printStep(5, `Creating branch '${TEST_BRANCH}'`);
    await createBranch(storage);

    // Step 6: Make changes and commit
    printStep(6, "Making changes and creating commit");
    const commitId = await makeChangesAndCommit(storage);

    // Step 7: Push changes
    printStep(7, "Pushing changes to remote using VCS transport");
    await pushChanges(storage, commitId);

    // Step 8: Verify with native git
    printStep(8, "Verifying with native git");
    await verifyWithNativeGit(commitId);

    // Success!
    printSection("SUCCESS!");
    console.log("\nThe example completed successfully!");
    console.log("- Created a branch using VCS");
    console.log("- Made a commit using VCS");
    console.log("- Pushed to remote using VCS transport");
    console.log("- Verified with native git");
  } catch (error) {
    printError(`Error: ${error instanceof Error ? error.message : error}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    // Cleanup
    if (server) {
      printInfo("\nStopping HTTP server...");
      await server.stop();
    }
  }
}

/**
 * Step 1: Setup remote repository with initial commit.
 */
async function setupRemoteRepository(): Promise<void> {
  // Clean up any existing test directories
  await removeDirectory(BASE_DIR);
  await ensureDirectory(BASE_DIR);

  // Create bare repository
  printInfo(`Creating bare repository at ${REMOTE_REPO_DIR}`);
  await ensureDirectory(REMOTE_REPO_DIR);
  runGit(["init", "--bare"], REMOTE_REPO_DIR);

  // Configure the bare repository to accept pushes
  runGit(["config", "receive.denyCurrentBranch", "ignore"], REMOTE_REPO_DIR);

  // Create a temporary working directory to make the initial commit
  const tempDir = path.join(BASE_DIR, "temp-init");
  await ensureDirectory(tempDir);

  // Initialize and create initial commit
  runGit(["init"], tempDir);
  runGit(["config", "user.email", "test@example.com"], tempDir);
  runGit(["config", "user.name", "Test User"], tempDir);

  // Create initial file
  await fs.writeFile(
    path.join(tempDir, "README.md"),
    "# Test Repository\n\nThis is a test repository for the VCS example.\n",
  );

  runGit(["add", "README.md"], tempDir);
  runGit(["commit", "-m", "Initial commit"], tempDir);
  runGit(["branch", "-M", DEFAULT_BRANCH], tempDir);
  runGit(["remote", "add", "origin", REMOTE_REPO_DIR], tempDir);
  runGit(["push", "-u", "origin", DEFAULT_BRANCH], tempDir);

  // Cleanup temp directory
  await removeDirectory(tempDir);

  // Verify
  const log = runGit(["log", "--oneline", "-1"], REMOTE_REPO_DIR);
  printSuccess(`Remote repository created with initial commit: ${log}`);
}

/**
 * Step 2: Start HTTP server.
 */
async function startHttpServer(): Promise<GitHttpServer> {
  printInfo(`Starting HTTP server on port ${HTTP_PORT}`);
  const server = await createGitHttpServer({
    port: HTTP_PORT,
    baseDir: BASE_DIR,
  });
  printSuccess(`HTTP server running at http://localhost:${HTTP_PORT}`);
  printInfo(`Repository available at ${REMOTE_URL}`);
  return server;
}

/**
 * Step 3: Clone repository using native git.
 * NOTE: Uses async git commands to avoid blocking the HTTP server.
 */
async function cloneWithNativeGit(): Promise<void> {
  printInfo(`Cloning from ${REMOTE_URL}`);
  await ensureDirectory(LOCAL_REPO_DIR);

  // Clone into local directory (async to not block HTTP server)
  await runGitAsync(["clone", REMOTE_URL, "."], LOCAL_REPO_DIR);
  await runGitAsync(["config", "user.email", "vcs@example.com"], LOCAL_REPO_DIR);
  await runGitAsync(["config", "user.name", "VCS Example"], LOCAL_REPO_DIR);

  // Fix permissions on git objects so VCS can read them
  await fixGitObjectPermissions(`${LOCAL_REPO_DIR}/.git`);

  const log = await runGitAsync(["log", "--oneline", "-1"], LOCAL_REPO_DIR);
  printSuccess(`Repository cloned: ${log}`);
}

/**
 * Step 4: Open repository with VCS.
 */
async function openRepositoryWithVcs(): Promise<GitStorage> {
  printInfo(`Opening repository at ${LOCAL_REPO_DIR}`);

  const files = new FilesApi(new NodeFilesApi({ fs, rootDir: LOCAL_REPO_DIR }));

  const storage = await createGitStorage(files, ".git", {
    create: false,
  });

  const headCommit = await storage.getHead();
  const currentBranch = await storage.getCurrentBranch();
  printSuccess(`Repository opened, HEAD at ${shortId(headCommit || "unknown")}`);
  printInfo(`Current branch: ${currentBranch}`);

  return storage;
}

/**
 * Step 5: Create new branch.
 */
async function createBranch(storage: GitStorage): Promise<void> {
  const headCommit = await storage.getHead();
  if (!headCommit) {
    throw new Error("No HEAD commit found");
  }

  // Create branch pointing to HEAD
  await storage.refs.set(`refs/heads/${TEST_BRANCH}`, headCommit);

  // Switch to new branch
  await storage.refs.setSymbolic("HEAD", `refs/heads/${TEST_BRANCH}`);

  printSuccess(`Created and switched to branch '${TEST_BRANCH}'`);
  printInfo(`Branch points to ${shortId(headCommit)}`);
}

/**
 * Step 6: Make changes and create commit.
 */
async function makeChangesAndCommit(storage: GitStorage): Promise<string> {
  // Get current commit to find parent tree
  const headCommit = await storage.getHead();
  if (!headCommit) {
    throw new Error("No HEAD commit found");
  }

  const parentCommit = await storage.commits.loadCommit(headCommit);
  const parentTree = parentCommit.tree;

  // Load existing tree entries
  const existingEntries: Array<{ mode: number; name: string; id: string }> = [];
  for await (const entry of storage.trees.loadTree(parentTree)) {
    existingEntries.push({
      mode: entry.mode,
      name: entry.name,
      id: entry.id,
    });
  }

  // Create a new file
  const newFileContent = `# Changes from VCS

This file was created by the VCS library.
Timestamp: ${new Date().toISOString()}
`;

  // Store blob
  const blobId = await storage.objects.store([new TextEncoder().encode(newFileContent)]);
  printInfo(`Created blob: ${shortId(blobId)}`);

  // Create new tree with the new file
  const newEntries = [
    ...existingEntries.filter((e) => e.name !== "CHANGES.md"),
    { mode: FileMode.REGULAR_FILE, name: "CHANGES.md", id: blobId },
  ];

  const treeId = await storage.trees.storeTree(newEntries);
  printInfo(`Created tree: ${shortId(treeId)}`);

  // Create commit
  const author = createAuthor();
  const commitId = await storage.commits.storeCommit({
    tree: treeId,
    parents: [headCommit],
    author,
    committer: author,
    message: "Add CHANGES.md from VCS\n\nThis commit was created using the VCS library.",
  });
  printInfo(`Created commit: ${shortId(commitId)}`);

  // Update branch ref
  await storage.refs.set(`refs/heads/${TEST_BRANCH}`, commitId);

  printSuccess(`Commit ${shortId(commitId)} created on branch '${TEST_BRANCH}'`);

  return commitId;
}

/**
 * Step 7: Push changes to remote.
 */
async function pushChanges(storage: GitStorage, commitId: string): Promise<void> {
  printInfo(`Pushing ${TEST_BRANCH} to remote...`);

  // Get all objects that need to be pushed
  const objectsToPush = await collectObjectsForPush(storage, commitId);

  printInfo(`Collected ${objectsToPush.length} objects to push`);

  const result = await push({
    url: REMOTE_URL,
    refspecs: [`refs/heads/${TEST_BRANCH}:refs/heads/${TEST_BRANCH}`],
    force: true, // Force push since it's a new branch
    getLocalRef: async (refName: string) => {
      const ref = await storage.refs.resolve(refName);
      return ref?.objectId;
    },
    getObjectsToPush: async function* () {
      for (const obj of objectsToPush) {
        yield obj;
      }
    },
    onProgressMessage: (msg) => {
      if (msg.trim()) {
        printInfo(`  ${msg.trim()}`);
      }
    },
  });

  if (result.ok) {
    printSuccess(`Push successful!`);
    printInfo(`Bytes sent: ${result.bytesSent}`);
    printInfo(`Objects sent: ${result.objectCount}`);
  } else {
    printError(`Push failed: ${result.unpackStatus}`);
    for (const [ref, status] of result.updates) {
      if (!status.ok) {
        printError(`  ${ref}: ${status.message}`);
      }
    }
    throw new Error("Push failed");
  }
}

/**
 * Collect objects needed for push.
 */
async function collectObjectsForPush(storage: GitStorage, commitId: string): Promise<PushObject[]> {
  const objects: PushObject[] = [];
  const seen = new Set<string>();

  async function collectObject(id: string): Promise<void> {
    if (seen.has(id)) return;
    seen.add(id);

    // Load raw object (includes git header like "commit 123\0...")
    const chunks: Uint8Array[] = [];
    for await (const chunk of storage.rawStorage.load(id)) {
      chunks.push(chunk);
    }
    const rawData = concatBytes(chunks);

    // Parse header to get type, extract just the content for the pack
    const header = parseObjectHeader(rawData);
    const content = extractGitObjectContent(rawData);

    objects.push({ id, type: header.typeCode, content });
  }

  async function collectTree(treeId: string): Promise<void> {
    await collectObject(treeId);

    for await (const entry of storage.trees.loadTree(treeId)) {
      if (entry.mode === FileMode.TREE) {
        await collectTree(entry.id);
      } else {
        await collectObject(entry.id);
      }
    }
  }

  // Collect the commit
  await collectObject(commitId);

  // Load commit to get tree
  const commit = await storage.commits.loadCommit(commitId);
  await collectTree(commit.tree);

  return objects;
}

/**
 * Concatenate byte arrays.
 */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Step 8: Verify with native git.
 * NOTE: Uses async git commands to avoid blocking the HTTP server.
 */
async function verifyWithNativeGit(expectedCommitId: string): Promise<void> {
  printInfo("Checking remote repository with native git...");

  // Check if branch exists
  const branches = await runGitAsync(["branch", "-a"], REMOTE_REPO_DIR);
  if (!branches.includes(TEST_BRANCH)) {
    printError(`Branch '${TEST_BRANCH}' not found in remote!`);
    printInfo(`Available branches: ${branches}`);
    throw new Error("Branch verification failed");
  }
  printSuccess(`Branch '${TEST_BRANCH}' exists in remote`);

  // Get commit ID from remote
  const remoteCommitId = await runGitAsync(
    ["rev-parse", `refs/heads/${TEST_BRANCH}`],
    REMOTE_REPO_DIR,
  );

  if (remoteCommitId === expectedCommitId) {
    printSuccess(`Commit ID matches: ${shortId(remoteCommitId)}`);
  } else {
    printError(`Commit ID mismatch!`);
    printError(`  Expected: ${expectedCommitId}`);
    printError(`  Got: ${remoteCommitId}`);
    throw new Error("Commit verification failed");
  }

  // Show commit details
  const commitInfo = await runGitAsync(
    ["log", "-1", "--format=%H %s", `refs/heads/${TEST_BRANCH}`],
    REMOTE_REPO_DIR,
  );
  printInfo(`Commit: ${commitInfo}`);

  // Verify file exists in commit
  const treeFiles = await runGitAsync(
    ["ls-tree", "--name-only", `refs/heads/${TEST_BRANCH}`],
    REMOTE_REPO_DIR,
  );
  if (treeFiles.includes("CHANGES.md")) {
    printSuccess("CHANGES.md file found in commit");
  } else {
    printError("CHANGES.md file not found!");
    throw new Error("File verification failed");
  }

  // Run git fsck for integrity check
  const fsckResult = await runGitSafeAsync(["fsck", "--full"], REMOTE_REPO_DIR);
  if (fsckResult.ok) {
    printSuccess("Repository integrity check passed (git fsck)");
  } else {
    printError(`Repository integrity check failed: ${fsckResult.output}`);
  }
}

// Run main
main();
