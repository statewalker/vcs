/**
 * Step 02: Create Initial Project with Files in Multiple Folders
 *
 * Creates a realistic project structure with multiple directories
 * and files using the FilesAPI and git.add() porcelain command.
 */

import {
  log,
  logInfo,
  logSection,
  logSuccess,
  shortId,
  state,
  writeFileToWorktree,
} from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 02: Create Initial Project with Files");

  const { git, files } = state;
  if (!git || !files) {
    throw new Error("Repository not initialized. Run step 01 first.");
  }

  log("Creating project structure...");

  // Define initial project files
  const projectFiles = new Map<string, string>();

  // Root files
  projectFiles.set(
    "README.md",
    `# Example Project

This is a demo project created by the WebRun VCS workflow demo.

## Features

- Demonstrates Git repository operations
- Shows VCS library capabilities
- Tests branching, merging, and GC

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

  // Write all files to working tree using FilesAPI
  for (const [filePath, content] of projectFiles) {
    await writeFileToWorktree(files, filePath, content);
    log(`  Created: ${filePath}`);
  }

  // Stage all files using git.add()
  log("\nStaging files with git.add()...");
  await git.add().addFilepattern(".").call();

  // Create initial commit
  const commit = await git
    .commit()
    .setMessage("Initial commit\n\nCreate project structure with multiple directories")
    .call();

  // Store in state
  state.commits.push({
    id: commit.id,
    message: "Initial commit",
    files: projectFiles,
    branch: "main",
  });
  state.initialFiles = projectFiles;

  logSuccess(`Created initial commit: ${shortId(commit.id)}`);
  logInfo("Files created", projectFiles.size);
}
