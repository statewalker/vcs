/**
 * HTTP Git Server Demo - Client Only Mode
 *
 * Demonstrates using VCS transport to interact with a Git HTTP server.
 * Works with both VCS-based servers and standard Git HTTP servers.
 *
 * Usage:
 *   pnpm client http://localhost:8080/repo.git          # Clone from URL
 *   pnpm client http://localhost:8080/repo.git --push   # Clone and push
 *
 * This demonstrates:
 * - Cloning via HTTP using VCS transport
 * - Making local changes with VCS
 * - Pushing changes back to the server
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  createGitRepository,
  FileMode,
  type GitRepository,
  indexPack,
  writePackIndex,
} from "@statewalker/vcs-core";
import { clone, type PushObject, push } from "@statewalker/vcs-transport";
import { setCompressionUtils } from "@statewalker/vcs-utils";
import { bytesToHex } from "@statewalker/vcs-utils/hash/utils";
import { createNodeCompression } from "@statewalker/vcs-utils-node/compression";
import { createNodeFilesApi } from "@statewalker/vcs-utils-node/files";

import {
  atomicWriteFile,
  concatBytes,
  createAuthor,
  ensureDirectory,
  ensureDirFiles,
  printError,
  printInfo,
  printSection,
  printStep,
  printSuccess,
  removeDirectory,
  shortId,
} from "./shared/index.js";

// Initialize compression
setCompressionUtils(createNodeCompression());

const textEncoder = new TextEncoder();

// Parse command line arguments
function parseArgs(): { url: string; shouldPush: boolean; localDir: string } {
  const args = process.argv.slice(2);
  let url = "";
  let shouldPush = false;
  let localDir = path.join(process.cwd(), "cloned-repo");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--push") {
      shouldPush = true;
    } else if (args[i] === "--dir" && args[i + 1]) {
      localDir = path.resolve(args[i + 1]);
      i++;
    } else if (!args[i].startsWith("--")) {
      url = args[i];
    }
  }

  return { url, shouldPush, localDir };
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const { url, shouldPush, localDir } = parseArgs();

  if (!url) {
    console.log("Usage: pnpm client <url> [--push] [--dir <path>]");
    console.log("");
    console.log("Examples:");
    console.log("  pnpm client http://localhost:8080/repo.git");
    console.log("  pnpm client http://localhost:8080/repo.git --push");
    console.log("  pnpm client http://github.com/user/repo.git --dir ./my-clone");
    process.exit(1);
  }

  printSection("HTTP Git Client Demo");
  console.log("Using VCS transport to interact with a Git HTTP server.\n");

  let repository: GitRepository | null = null;

  try {
    // Step 1: Clone
    printStep(1, "Cloning repository");
    repository = await cloneRepository(url, localDir);

    if (shouldPush) {
      // Step 2: Make changes
      printStep(2, "Creating changes");
      const { commitId } = await makeChanges(repository, localDir);

      // Step 3: Push
      printStep(3, "Pushing changes");
      await pushChanges(repository, url, commitId);
    }

    printSection("SUCCESS!");
    console.log(`\nRepository cloned to: ${localDir}`);
    if (shouldPush) {
      console.log("Changes pushed successfully!");
    }
  } catch (error) {
    printError(`Error: ${error instanceof Error ? error.message : error}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    if (repository) {
      await repository.close();
    }
  }
}

/**
 * Clone a repository using VCS transport.
 */
async function cloneRepository(url: string, localDir: string): Promise<GitRepository> {
  printInfo(`Cloning from: ${url}`);
  printInfo(`Destination: ${localDir}`);

  // Clean up and create directory
  await removeDirectory(localDir);
  await ensureDirectory(localDir);
  const gitDir = path.join(localDir, ".git");
  await ensureDirectory(gitDir);

  // Perform clone
  const cloneResult = await clone({
    url,
    onProgressMessage: (msg) => {
      if (msg.trim()) {
        printInfo(`  ${msg.trim()}`);
      }
    },
  });

  printInfo(`Received ${cloneResult.bytesReceived} bytes`);
  printInfo(`Default branch: ${cloneResult.defaultBranch}`);
  printInfo(`Refs received: ${cloneResult.refs.size}`);

  // Create local repository
  const files = createNodeFilesApi({ rootDir: localDir });
  const repository = (await createGitRepository(files, ".git", {
    create: true,
    defaultBranch: cloneResult.defaultBranch,
  })) as GitRepository;

  // Process pack data
  if (cloneResult.packData.length > 0) {
    printInfo("Processing pack data...");

    const indexResult = await indexPack(cloneResult.packData);
    printInfo(`Pack contains ${indexResult.objectCount} objects`);

    const packChecksum = bytesToHex(indexResult.packChecksum);
    const packDir = ".git/objects/pack";
    await ensureDirFiles(files, packDir);

    const packPath = `${packDir}/pack-${packChecksum}.pack`;
    const idxPath = `${packDir}/pack-${packChecksum}.idx`;

    await atomicWriteFile(files, packPath, cloneResult.packData);
    const indexData = await writePackIndex(indexResult.entries, indexResult.packChecksum);
    await atomicWriteFile(files, idxPath, indexData);
  }

  // Set up refs
  for (const [refName, objectId] of cloneResult.refs) {
    await repository.refs.set(refName, bytesToHex(objectId));
  }

  // Set up local main branch
  const mainRef = cloneResult.refs.get(`refs/remotes/origin/${cloneResult.defaultBranch}`);
  if (mainRef) {
    await repository.refs.set(`refs/heads/${cloneResult.defaultBranch}`, bytesToHex(mainRef));
  }

  await repository.refs.setSymbolic("HEAD", `refs/heads/${cloneResult.defaultBranch}`);

  // Checkout working tree
  await checkoutHead(repository, localDir);

  printSuccess(`Repository cloned successfully`);

  return repository;
}

/**
 * Checkout HEAD to working tree.
 */
async function checkoutHead(repository: GitRepository, localDir: string): Promise<void> {
  const headCommit = await repository.getHead();
  if (!headCommit) {
    printInfo("Empty repository - no checkout needed");
    return;
  }

  const commit = await repository.commits.loadCommit(headCommit);
  await extractTree(repository, commit.tree, localDir);
}

/**
 * Extract a tree to a directory.
 */
async function extractTree(
  repository: GitRepository,
  treeId: string,
  dirPath: string,
): Promise<void> {
  for await (const entry of repository.trees.loadTree(treeId)) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.mode === FileMode.TREE) {
      await ensureDirectory(entryPath);
      await extractTree(repository, entry.id, entryPath);
    } else {
      const chunks: Uint8Array[] = [];
      for await (const chunk of repository.blobs.load(entry.id)) {
        chunks.push(chunk);
      }
      const content = concatBytes(...chunks);
      await fs.writeFile(entryPath, content);
    }
  }
}

/**
 * Make changes to the repository.
 */
async function makeChanges(
  repository: GitRepository,
  localDir: string,
): Promise<{ newTreeId: string; commitId: string }> {
  const headCommit = await repository.getHead();
  if (!headCommit) {
    throw new Error("Cannot push to empty repository");
  }

  const commit = await repository.commits.loadCommit(headCommit);

  // Get existing tree entries
  const existingEntries: Array<{ mode: number; name: string; id: string }> = [];
  for await (const entry of repository.trees.loadTree(commit.tree)) {
    existingEntries.push({
      mode: entry.mode,
      name: entry.name,
      id: entry.id,
    });
  }

  // Create a new file
  const newFileContent = `# Client Demo

This file was created by the VCS client demo.

Timestamp: ${new Date().toISOString()}
`;

  const newBlobId = await repository.blobs.store([textEncoder.encode(newFileContent)]);
  printInfo(`Created blob: ${shortId(newBlobId)}`);

  // Create new tree
  const newEntries = [
    ...existingEntries.filter((e) => e.name !== "CLIENT-DEMO.md"),
    { mode: FileMode.REGULAR_FILE, name: "CLIENT-DEMO.md", id: newBlobId },
  ];

  const newTreeId = await repository.trees.storeTree(newEntries);
  printInfo(`Created tree: ${shortId(newTreeId)}`);

  // Write file to working directory
  await fs.writeFile(path.join(localDir, "CLIENT-DEMO.md"), newFileContent);

  // Create commit
  const author = createAuthor();
  const commitId = await repository.commits.storeCommit({
    tree: newTreeId,
    parents: [headCommit],
    author,
    committer: author,
    message: "Add CLIENT-DEMO.md via VCS client",
  });
  printInfo(`Created commit: ${shortId(commitId)}`);

  // Update HEAD
  const headRef = await repository.refs.get("HEAD");
  if (headRef && "target" in headRef && headRef.target) {
    await repository.refs.set(headRef.target, commitId);
  }

  printSuccess("Changes created successfully");

  return { newTreeId, commitId };
}

/**
 * Push changes to remote.
 */
async function pushChanges(
  repository: GitRepository,
  url: string,
  commitId: string,
): Promise<void> {
  printInfo(`Pushing to: ${url}`);

  // Get current branch
  const headRef = await repository.refs.get("HEAD");
  if (!headRef || !("target" in headRef) || !headRef.target) {
    throw new Error("HEAD is not on a branch");
  }

  const branchName = headRef.target.replace("refs/heads/", "");
  const refspec = `refs/heads/${branchName}:refs/heads/${branchName}`;

  printInfo(`Pushing branch: ${branchName}`);

  // Collect objects to push
  const objects = await collectObjectsForPush(repository, commitId);
  printInfo(`Objects to push: ${objects.length}`);

  // Push
  const result = await push({
    url,
    refspecs: [refspec],
    force: true,
    getLocalRef: async (refName: string) => {
      const ref = await repository.refs.resolve(refName);
      return ref?.objectId;
    },
    getObjectsToPush: async function* () {
      for (const obj of objects) {
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
    printSuccess("Push successful!");
    printInfo(`Bytes sent: ${result.bytesSent}`);
  } else {
    throw new Error(`Push failed: ${result.unpackStatus}`);
  }
}

/**
 * Collect objects needed for push.
 */
async function collectObjectsForPush(
  repository: GitRepository,
  commitId: string,
): Promise<PushObject[]> {
  const objects: PushObject[] = [];
  const seen = new Set<string>();

  const typeStringToCode: Record<string, number> = {
    commit: 1,
    tree: 2,
    blob: 3,
    tag: 4,
  };

  async function collectObject(id: string): Promise<void> {
    if (seen.has(id)) return;
    seen.add(id);

    const header = await repository.objects.getHeader(id);
    const typeCode = typeStringToCode[header.type];

    const chunks: Uint8Array[] = [];
    for await (const chunk of repository.objects.load(id)) {
      chunks.push(chunk);
    }
    const content = concatBytes(...chunks);

    objects.push({ id, type: typeCode, content });
  }

  async function collectTree(treeId: string): Promise<void> {
    await collectObject(treeId);

    for await (const entry of repository.trees.loadTree(treeId)) {
      if (entry.mode === FileMode.TREE) {
        await collectTree(entry.id);
      } else {
        await collectObject(entry.id);
      }
    }
  }

  await collectObject(commitId);

  const commit = await repository.commits.loadCommit(commitId);
  await collectTree(commit.tree);

  return objects;
}

// Run main
main();
