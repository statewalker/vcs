/**
 * Shared utilities for the branching and merging example
 */

import { createGitStore, Git, type GitStore } from "@statewalker/vcs-commands";
import { createGitRepository, FileMode, type GitRepository } from "@statewalker/vcs-core";
import { MemoryStagingStore } from "@statewalker/vcs-store-mem";

// Shared state
let sharedStore: GitStore | null = null;
let sharedGit: Git | null = null;
let sharedRepository: GitRepository | null = null;

/**
 * Get or create the shared Git store and facade
 */
export async function getGit(): Promise<{ git: Git; store: GitStore; repository: GitRepository }> {
  if (!sharedStore || !sharedGit || !sharedRepository) {
    sharedRepository = await createGitRepository();
    const staging = new MemoryStagingStore();
    sharedStore = createGitStore({ repository: sharedRepository, staging });
    sharedGit = Git.wrap(sharedStore);
  }
  return { git: sharedGit, store: sharedStore, repository: sharedRepository };
}

/**
 * Reset the shared state (for fresh start)
 */
export function resetState(): void {
  sharedStore = null;
  sharedGit = null;
  sharedRepository = null;
}

/**
 * Helper function to add a file to staging
 */
export async function addFileToStaging(
  store: GitStore,
  path: string,
  content: string,
): Promise<string> {
  const data = new TextEncoder().encode(content);
  const objectId = await store.blobs.store([data]);

  const editor = store.staging.editor();
  editor.add({
    path,
    apply: () => ({
      path,
      mode: FileMode.REGULAR_FILE,
      objectId,
      stage: 0,
      size: data.length,
      mtime: Date.now(),
    }),
  });
  await editor.finish();

  return objectId;
}

/**
 * Format ObjectId for display
 */
export function shortId(id: string): string {
  return id.slice(0, 7);
}

/**
 * Print a section header
 */
export function printSection(title: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

/**
 * Print a step header
 */
export function printStep(num: number, title: string): void {
  console.log(`\n--- Step ${num}: ${title} ---`);
}

export type { Git, GitStore } from "@statewalker/vcs-commands";
export { FileMode } from "@statewalker/vcs-core";
