/**
 * Example 6: High-Level Repository API
 *
 * This example demonstrates the high-level Repository API for Git operations.
 * Unlike examples 1-5 which work directly with pack files, this approach uses
 * typed stores that abstract away the underlying storage format.
 *
 * Key differences from low-level pack examples:
 * - No need to understand pack file format
 * - No manual delta handling
 * - Typed interfaces for blobs, trees, commits, refs
 * - Automatic content-addressable storage
 * - Works with both loose objects and pack files transparently
 *
 * When to use high-level API:
 * - Building Git clients or tools
 * - Working with repository content
 * - Creating commits, branches, tags
 * - Most common Git operations
 *
 * When to use low-level pack API (examples 1-5):
 * - Optimizing pack file size with delta compression
 * - Implementing Git transport protocols
 * - Analyzing pack file structure
 * - Building pack file tools
 */

import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import { createGitRepository, type GitRepository } from "@webrun-vcs/storage-git";
import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { FileMode, type PersonIdent } from "@webrun-vcs/vcs";

// Initialize compression
setCompression(createNodeCompression());

/**
 * Format ObjectId for display
 */
function formatId(id: string, length = 7): string {
  return id.substring(0, length);
}

/**
 * Print section header
 */
function printSection(title: string): void {
  console.log(`\n--- ${title} ---`);
}

/**
 * Print key-value info
 */
function printInfo(key: string, value: string | number | boolean): void {
  console.log(`  ${key}: ${value}`);
}

/**
 * Create a PersonIdent for commits
 */
function createAuthor(): PersonIdent {
  return {
    name: "Example User",
    email: "example@example.com",
    timestamp: Math.floor(Date.now() / 1000),
    tzOffset: "+0000",
  };
}

async function main() {
  console.log("\n=== High-Level Repository API Example ===\n");
  console.log("This example demonstrates the Repository API with typed stores.");
  console.log("Compare with examples 1-5 for low-level pack file operations.\n");

  // Create an in-memory file system
  const files = new FilesApi(new MemFilesApi());

  // Initialize repository using high-level factory
  printSection("Creating Repository");
  const repository = (await createGitRepository(files, "/.git", {
    create: true,
    defaultBranch: "main",
  })) as GitRepository;

  printInfo("Repository path", "/.git");
  printInfo("Default branch", "main");

  // Store blobs using typed BlobStore
  printSection("Storing Blobs (repository.blobs.store)");

  const readmeContent = "# My Project\n\nWelcome to my project!\n";
  const codeContent = 'export function greet() {\n  return "Hello, World!";\n}\n';

  const readmeId = await repository.blobs.store([new TextEncoder().encode(readmeContent)]);
  const codeId = await repository.blobs.store([new TextEncoder().encode(codeContent)]);

  printInfo("README.md blob", formatId(readmeId));
  printInfo("index.ts blob", formatId(codeId));

  // Demonstrate content-addressable deduplication
  const duplicateId = await repository.blobs.store([new TextEncoder().encode(readmeContent)]);
  printInfo("Duplicate blob", formatId(duplicateId));
  printInfo("IDs match (deduplication)", readmeId === duplicateId ? "YES" : "NO");

  // Read blob content back
  printSection("Reading Blobs (repository.blobs.load)");

  const chunks: Uint8Array[] = [];
  for await (const chunk of repository.blobs.load(readmeId)) {
    chunks.push(chunk);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const content = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.length;
  }
  const readContent = new TextDecoder().decode(content);

  printInfo("Content matches", readContent === readmeContent ? "YES" : "NO");
  printInfo("Content preview", readContent.split("\n")[0]);

  // Get object metadata
  printSection("Object Metadata (repository.objects.getHeader)");

  const header = await repository.objects.getHeader(readmeId);
  printInfo("Object type", header.type);
  printInfo("Object size", `${header.size} bytes`);

  // Create tree using typed TreeStore
  printSection("Creating Tree (repository.trees.storeTree)");

  const treeId = await repository.trees.storeTree([
    { mode: FileMode.REGULAR_FILE, name: "README.md", id: readmeId },
    { mode: FileMode.REGULAR_FILE, name: "index.ts", id: codeId },
  ]);

  printInfo("Tree ID", formatId(treeId));

  // Load and display tree entries
  console.log("\n  Tree entries:");
  for await (const entry of repository.trees.loadTree(treeId)) {
    console.log(
      `    ${entry.mode.toString(8).padStart(6, "0")} ${entry.name} ${formatId(entry.id)}`,
    );
  }

  // Create commit using typed CommitStore
  printSection("Creating Commit (repository.commits.storeCommit)");

  const author = createAuthor();
  const commitId = await repository.commits.storeCommit({
    tree: treeId,
    parents: [],
    author,
    committer: author,
    message: "Initial commit\n\nCreated using the high-level Repository API.",
  });

  printInfo("Commit ID", formatId(commitId));

  // Load commit and display
  const commit = await repository.commits.loadCommit(commitId);
  console.log("\n  Commit details:");
  printInfo("Tree", formatId(commit.tree));
  printInfo("Author", commit.author.name);
  printInfo("Message", commit.message.split("\n")[0]);

  // Update refs using RefStore
  printSection("Managing Refs (repository.refs)");

  await repository.refs.set("refs/heads/main", commitId);
  const resolvedRef = await repository.refs.resolve("refs/heads/main");

  printInfo("refs/heads/main", formatId(resolvedRef?.objectId || ""));
  printInfo("Commit matches", resolvedRef?.objectId === commitId ? "YES" : "NO");

  // Create a second commit to show parent relationship
  printSection("Creating Second Commit");

  const updatedReadme = "# My Project\n\nWelcome to my project!\n\n## Version 2\n";
  const updatedReadmeId = await repository.blobs.store([new TextEncoder().encode(updatedReadme)]);

  const updatedTreeId = await repository.trees.storeTree([
    { mode: FileMode.REGULAR_FILE, name: "README.md", id: updatedReadmeId },
    { mode: FileMode.REGULAR_FILE, name: "index.ts", id: codeId },
  ]);

  const secondCommitId = await repository.commits.storeCommit({
    tree: updatedTreeId,
    parents: [commitId], // Parent is first commit
    author,
    committer: author,
    message: "Update README.md\n\nAdded version 2 section.",
  });

  printInfo("Second commit", formatId(secondCommitId));
  printInfo("Parent", formatId(commitId));

  // Update ref
  await repository.refs.set("refs/heads/main", secondCommitId);

  // Walk commit history
  printSection("Commit History");

  let currentCommit: string | undefined = secondCommitId;
  let depth = 0;

  while (currentCommit && depth < 10) {
    const c = await repository.commits.loadCommit(currentCommit);
    console.log(`  ${depth + 1}. ${formatId(currentCommit)} - ${c.message.split("\n")[0]}`);
    currentCommit = c.parents[0];
    depth++;
  }

  // Summary: Comparison with pack file examples
  printSection("API Comparison Summary");

  console.log(`
  Low-level Pack API (examples 1-5):
    - Direct pack file manipulation
    - Manual delta encoding/decoding
    - Full control over compression
    - Required for transport protocols
    - Example: PackReader, writePack, writePackIndexV2

  High-level Repository API (this example):
    - Typed stores: blobs, trees, commits, refs
    - Automatic content-addressable storage
    - Transparent pack file handling
    - Suitable for most Git operations
    - Example: repository.blobs.store(), repository.commits.storeCommit()

  Choose low-level when:
    - Implementing pack file optimization
    - Building Git network protocols
    - Analyzing/debugging pack structure

  Choose high-level when:
    - Building Git clients/tools
    - Working with repository content
    - Standard commit/branch operations
`);

  // Clean up
  await repository.close();

  console.log("Done!\n");
}

main().catch((err) => {
  console.error("Error:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
