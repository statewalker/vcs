/**
 * Step 03: Generate Commits with Incremental Changes
 *
 * Creates a series of commits that modify files incrementally,
 * demonstrating commit history building.
 */

import {
  addFileToStaging,
  log,
  logInfo,
  logSection,
  logSuccess,
  shortId,
  state,
} from "../shared/index.js";

const TOTAL_COMMITS = 10;

export async function run(): Promise<void> {
  logSection("Step 03: Generate Commits with Changes");

  const { store, git } = state;
  if (!store || !git) {
    throw new Error("Repository not initialized. Run step 01 first.");
  }

  if (state.commits.length === 0) {
    throw new Error("No initial commit found. Run step 02 first.");
  }

  log(`Generating ${TOTAL_COMMITS - 1} additional commits...`);

  let currentFiles = new Map(state.initialFiles);

  for (let i = 2; i <= TOTAL_COMMITS; i++) {
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
        await addFileToStaging(store, newFileName, content);
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
        const newContent = mathContent + newFunction;
        updatedFiles.set("src/utils/math.ts", newContent);
        await addFileToStaging(store, "src/utils/math.ts", newContent);
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
        const newContent = readme + newSection;
        updatedFiles.set("README.md", newContent);
        await addFileToStaging(store, "README.md", newContent);
        message = `Update README for version ${i}`;
        break;
      }
      case 3: {
        // Add test file
        const testFileName = `tests/feature${i}.test.ts`;
        const testContent = generateTestFile(i);
        updatedFiles.set(testFileName, testContent);
        await addFileToStaging(store, testFileName, testContent);
        message = `Add tests for feature ${i}`;
        break;
      }
      default:
        message = `Commit ${i}`;
    }

    // Create the commit
    const commit = await git.commit().setMessage(message).call();
    const commitId = await store.commits.storeCommit(commit);

    state.commits.push({
      id: commitId,
      message,
      files: updatedFiles,
      branch: "main",
    });

    log(`  Commit ${i}: ${shortId(commitId)} - ${message}`);

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
