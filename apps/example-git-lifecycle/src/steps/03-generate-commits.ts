/**
 * Step 03: Generate 20 Commits with Incremental Changes
 *
 * Creates a series of commits that modify files incrementally,
 * creating good opportunities for delta compression.
 */

import { FileMode, type ObjectId } from "@statewalker/vcs-core";
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

const TOTAL_COMMITS = 20;

export async function run(): Promise<void> {
  logSection("Step 03: Generate 20 Commits with Changes");

  const repository = state.repository;
  if (!repository) {
    throw new Error("Repository not initialized. Run step 01 first.");
  }

  if (state.commits.length === 0) {
    throw new Error("No initial commit found. Run step 02 first.");
  }

  log(`Generating ${TOTAL_COMMITS - 1} additional commits...`);

  let baseTimestamp = Math.floor(Date.now() / 1000);
  let lastCommitId = state.commits[state.commits.length - 1].id;
  let currentFiles = new Map(state.initialFiles);

  for (let i = 2; i <= TOTAL_COMMITS; i++) {
    baseTimestamp += 60; // Each commit 1 minute apart

    // Determine what type of change to make
    const changeType = i % 4;

    let message: string;
    const updatedFiles = new Map(currentFiles);

    switch (changeType) {
      case 0: {
        // Add a new file
        const newFileName = `src/feature${i}.ts`;
        const content = generateFeatureFile(i);
        updatedFiles.set(newFileName, content);
        message = `Add feature ${i}`;
        break;
      }
      case 1: {
        // Modify an existing file (append to it)
        const mathContent = updatedFiles.get("src/utils/math.ts") ?? "";
        const newFunction = `
export function power${i}(base: number): number {
  return Math.pow(base, ${i});
}
`;
        updatedFiles.set("src/utils/math.ts", mathContent + newFunction);
        message = `Add power${i} function to math utils`;
        break;
      }
      case 2: {
        // Update README
        const readme = updatedFiles.get("README.md") ?? "";
        const newSection = `
## Version ${i}

Added new features in this version.
`;
        updatedFiles.set("README.md", readme + newSection);
        message = `Update README for version ${i}`;
        break;
      }
      case 3: {
        // Add test file
        const testFileName = `tests/feature${i}.test.ts`;
        const testContent = generateTestFile(i);
        updatedFiles.set(testFileName, testContent);
        message = `Add tests for feature ${i}`;
        break;
      }
      default:
        message = `Commit ${i}`;
    }

    // Create the commit
    const commitId = await createCommit(
      repository,
      lastCommitId,
      updatedFiles,
      message,
      baseTimestamp,
    );

    state.commits.push({
      id: commitId,
      message,
      files: updatedFiles,
    });

    log(`  Commit ${i}: ${shortId(commitId)} - ${message}`);

    lastCommitId = commitId;
    currentFiles = updatedFiles;
  }

  logSuccess(`Generated ${state.commits.length} total commits`);
  logInfo("Total files in final commit", currentFiles.size);
}

function generateFeatureFile(num: number): string {
  return `/**
 * Feature ${num} implementation
 */

export interface Feature${num}Config {
  enabled: boolean;
  value: number;
  name: string;
}

export class Feature${num} {
  private config: Feature${num}Config;

  constructor(config: Feature${num}Config) {
    this.config = config;
  }

  run(): string {
    if (!this.config.enabled) {
      return "Feature ${num} is disabled";
    }
    return \`Feature ${num}: \${this.config.name} = \${this.config.value}\`;
  }

  getValue(): number {
    return this.config.value * ${num};
  }
}

export function createFeature${num}(name: string): Feature${num} {
  return new Feature${num}({
    enabled: true,
    value: ${num * 10},
    name,
  });
}
`;
}

function generateTestFile(num: number): string {
  return `import { describe, it, expect } from "vitest";
import { Feature${num}, createFeature${num} } from "../src/feature${num}";

describe("Feature${num}", () => {
  it("creates feature with default config", () => {
    const feature = createFeature${num}("test");
    expect(feature.getValue()).toBe(${num * num * 10});
  });

  it("runs when enabled", () => {
    const feature = createFeature${num}("demo");
    const result = feature.run();
    expect(result).toContain("Feature ${num}");
    expect(result).toContain("demo");
  });

  it("returns disabled message when disabled", () => {
    const feature = new Feature${num}({
      enabled: false,
      value: 0,
      name: "disabled",
    });
    expect(feature.run()).toBe("Feature ${num} is disabled");
  });
});
`;
}

async function createCommit(
  repository: NonNullable<typeof state.repository>,
  parentId: ObjectId,
  files: Map<string, string>,
  message: string,
  timestamp: number,
): Promise<ObjectId> {
  // Store all blobs
  const blobMap = new Map<string, string>();
  for (const [path, content] of files) {
    const blobId = await storeBlob(repository, content);
    blobMap.set(path, blobId);
  }

  // Build tree structure (simplified version that handles up to 2 levels)
  const rootEntries: { mode: number; name: string; id: string }[] = [];
  const directories = new Map<string, Map<string, { mode: number; id: string }>>();

  for (const [filePath, blobId] of blobMap) {
    const parts = filePath.split("/");
    if (parts.length === 1) {
      rootEntries.push({ mode: FileMode.REGULAR_FILE, name: parts[0], id: blobId });
    } else if (parts.length === 2) {
      const [dir, file] = parts;
      if (!directories.has(dir)) {
        directories.set(dir, new Map());
      }
      directories.get(dir)?.set(file, { mode: FileMode.REGULAR_FILE, id: blobId });
    } else if (parts.length === 3) {
      const [topDir, subDir, file] = parts;
      const key = `${topDir}/${subDir}`;
      if (!directories.has(key)) {
        directories.set(key, new Map());
      }
      directories.get(key)?.set(file, { mode: FileMode.REGULAR_FILE, id: blobId });
    }
  }

  // Create leaf directory trees first
  const dirTrees = new Map<string, string>();
  for (const [dirPath, fileMap] of directories) {
    if (dirPath.includes("/")) {
      const entries = Array.from(fileMap).map(([name, { mode, id }]) => ({ mode, name, id }));
      entries.sort((a, b) => a.name.localeCompare(b.name));
      const treeId = await repository.trees.storeTree(entries);
      dirTrees.set(dirPath, treeId);
    }
  }

  // Create parent directory trees
  const topDirs = new Map<string, { mode: number; name: string; id: string }[]>();

  for (const [dirPath, fileMap] of directories) {
    if (!dirPath.includes("/")) {
      const entries: { mode: number; name: string; id: string }[] = [];
      for (const [name, { mode, id }] of fileMap) {
        entries.push({ mode, name, id });
      }
      topDirs.set(dirPath, entries);
    }
  }

  // Add subdirectory trees to parent dirs
  for (const [dirPath, treeId] of dirTrees) {
    const [parent, subDir] = dirPath.split("/");
    if (!topDirs.has(parent)) {
      topDirs.set(parent, []);
    }
    topDirs.get(parent)?.push({ mode: FileMode.TREE, name: subDir, id: treeId });
  }

  // Create top-level directory trees
  for (const [dirName, entries] of topDirs) {
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const treeId = await repository.trees.storeTree(entries);
    rootEntries.push({ mode: FileMode.TREE, name: dirName, id: treeId });
  }

  // Sort and create root tree
  rootEntries.sort((a, b) => a.name.localeCompare(b.name));
  const rootTreeId = await repository.trees.storeTree(rootEntries);

  // Create commit
  const author = createAuthor("Demo User", "demo@example.com", timestamp);
  const commitId = await repository.commits.storeCommit({
    tree: rootTreeId,
    parents: [parentId],
    author,
    committer: author,
    message,
  });

  // Update ref
  await repository.refs.set("refs/heads/main", commitId);

  return commitId;
}
