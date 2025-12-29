/**
 * Step 02: Create Initial Project with Files in Multiple Folders
 *
 * Creates a realistic project structure with multiple directories
 * and files to demonstrate tree handling.
 */

import { FileMode } from "@webrun-vcs/core";
import {
  createAuthor,
  log,
  logInfo,
  logSection,
  logSuccess,
  shortId,
  state,
  storeBlob,
} from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 02: Create Initial Project with Files");

  const repository = state.repository;
  if (!repository) {
    throw new Error("Repository not initialized. Run step 01 first.");
  }

  log("Creating project structure...");

  // Define initial project files
  const projectFiles = new Map<string, string>();

  // Root files
  projectFiles.set(
    "README.md",
    `# Example Project

This is a demo project created by the webrun-vcs lifecycle example.

## Features

- Demonstrates Git repository operations
- Shows VCS library capabilities
- Tests GC and pack file creation

## Structure

- \`src/\` - Source code
- \`tests/\` - Test files
- \`docs/\` - Documentation
`,
  );

  projectFiles.set(
    "package.json",
    JSON.stringify(
      {
        name: "example-project",
        version: "1.0.0",
        main: "src/index.ts",
        scripts: {
          build: "tsc",
          test: "vitest",
        },
      },
      null,
      2,
    ),
  );

  projectFiles.set(
    ".gitignore",
    `node_modules/
dist/
*.log
.env
`,
  );

  // Source files
  projectFiles.set(
    "src/index.ts",
    `export function main(): void {
  console.log("Hello from example project!");
}

main();
`,
  );

  projectFiles.set(
    "src/utils/helpers.ts",
    `export function formatDate(date: Date): string {
  return date.toISOString();
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
`,
  );

  projectFiles.set(
    "src/utils/math.ts",
    `export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`,
  );

  // Test files
  projectFiles.set(
    "tests/utils.test.ts",
    `import { describe, it, expect } from "vitest";
import { add, multiply } from "../src/utils/math";

describe("math utils", () => {
  it("adds numbers", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("multiplies numbers", () => {
    expect(multiply(2, 3)).toBe(6);
  });
});
`,
  );

  // Documentation
  projectFiles.set(
    "docs/API.md",
    `# API Documentation

## Functions

### add(a, b)
Adds two numbers together.

### multiply(a, b)
Multiplies two numbers.
`,
  );

  // Store all blobs
  const blobMap = new Map<string, string>();
  for (const [path, content] of projectFiles) {
    const blobId = await storeBlob(repository, content);
    blobMap.set(path, blobId);
    log(`  Created blob for ${path} -> ${shortId(blobId)}`);
  }

  // Build tree structure
  // We need to create subtrees for directories
  const rootEntries: { mode: number; name: string; id: string }[] = [];

  // Group files by directory
  const directories = new Map<string, Map<string, string>>();

  for (const [filePath, blobId] of blobMap) {
    const parts = filePath.split("/");
    if (parts.length === 1) {
      // Root file
      rootEntries.push({ mode: FileMode.REGULAR_FILE, name: parts[0], id: blobId });
    } else {
      // File in subdirectory
      const dir = parts.slice(0, -1).join("/");
      const fileName = parts[parts.length - 1];
      if (!directories.has(dir)) {
        directories.set(dir, new Map());
      }
      const dirMap = directories.get(dir);
      if (dirMap) {
        dirMap.set(fileName, blobId);
      }
    }
  }

  // Create subtrees for directories (simplified - only handles one level deep subdirs)
  const dirTrees = new Map<string, string>();

  // First pass: create leaf directory trees
  for (const [dirPath, files] of directories) {
    const parts = dirPath.split("/");
    if (parts.length === 2) {
      // Leaf directory like src/utils
      const entries = Array.from(files).map(([name, id]) => ({
        mode: FileMode.REGULAR_FILE,
        name,
        id,
      }));
      const treeId = await repository.trees.storeTree(entries);
      dirTrees.set(dirPath, treeId);
      log(`  Created tree for ${dirPath} -> ${shortId(treeId)}`);
    }
  }

  // Second pass: create parent directory trees
  const parentDirs = new Map<string, { mode: number; name: string; id: string }[]>();

  for (const [dirPath, files] of directories) {
    const parts = dirPath.split("/");
    if (parts.length === 1) {
      // Top-level directory like src, tests, docs
      const parentName = parts[0];
      if (!parentDirs.has(parentName)) {
        parentDirs.set(parentName, []);
      }
      const entries = parentDirs.get(parentName);
      if (entries) {
        // Add direct files
        for (const [name, id] of files) {
          entries.push({ mode: FileMode.REGULAR_FILE, name, id });
        }
      }
    }
  }

  // Add subdirectory trees to parent dirs
  for (const [dirPath, treeId] of dirTrees) {
    const parts = dirPath.split("/");
    const parentName = parts[0];
    const subDirName = parts[1];
    if (!parentDirs.has(parentName)) {
      parentDirs.set(parentName, []);
    }
    const entries = parentDirs.get(parentName);
    if (entries) {
      entries.push({ mode: FileMode.TREE, name: subDirName, id: treeId });
    }
  }

  // Create top-level directory trees
  for (const [dirName, entries] of parentDirs) {
    // Sort entries by name for consistent tree hashes
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const treeId = await repository.trees.storeTree(entries);
    rootEntries.push({ mode: FileMode.TREE, name: dirName, id: treeId });
    log(`  Created tree for ${dirName}/ -> ${shortId(treeId)}`);
  }

  // Sort root entries
  rootEntries.sort((a, b) => a.name.localeCompare(b.name));

  // Create root tree
  const rootTreeId = await repository.trees.storeTree(rootEntries);
  log(`  Created root tree -> ${shortId(rootTreeId)}`);

  // Create initial commit
  const author = createAuthor();
  const commitId = await repository.commits.storeCommit({
    tree: rootTreeId,
    parents: [],
    author,
    committer: author,
    message: "Initial commit\n\nCreate project structure with multiple directories",
  });

  // Update refs
  await repository.refs.set("refs/heads/main", commitId);

  // Store in state
  state.commits.push({
    id: commitId,
    message: "Initial commit",
    files: projectFiles,
  });
  state.initialFiles = projectFiles;

  logSuccess(`Created initial commit: ${shortId(commitId)}`);
  logInfo("Files created", projectFiles.size);
  logInfo("Directories", parentDirs.size);
}
