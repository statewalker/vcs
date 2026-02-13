/**
 * Shared utilities for the history operations example
 */

import { Git } from "@statewalker/vcs-commands";
import {
  createMemoryCheckout,
  createMemoryHistory,
  createMemoryWorkingCopy,
  createMemoryWorktree,
  createSimpleStaging,
  FileMode,
  type History,
  type WorkingCopy,
} from "@statewalker/vcs-core";

// Shared state
let sharedWorkingCopy: WorkingCopy | null = null;
let sharedGit: Git | null = null;
let sharedHistory: History | null = null;

/**
 * Get or create the shared Git working copy and facade
 */
export async function getGit(): Promise<{
  git: Git;
  workingCopy: WorkingCopy;
  history: History;
}> {
  if (!sharedWorkingCopy || !sharedGit || !sharedHistory) {
    // Create the History (object store)
    sharedHistory = createMemoryHistory();
    await sharedHistory.initialize();

    // Create the Staging area
    const staging = createSimpleStaging();

    // Create the Checkout (HEAD, staging, operation states)
    const checkout = createMemoryCheckout({ staging });

    // Create the Worktree (filesystem access)
    const worktree = createMemoryWorktree({
      blobs: sharedHistory.blobs,
      trees: sharedHistory.trees,
    });

    // Compose into WorkingCopy
    sharedWorkingCopy = createMemoryWorkingCopy({
      history: sharedHistory,
      checkout,
      worktree,
    });

    // Create Git facade
    sharedGit = Git.fromWorkingCopy(sharedWorkingCopy);
  }
  return { git: sharedGit, workingCopy: sharedWorkingCopy, history: sharedHistory };
}

/**
 * Reset the shared state (for fresh start)
 */
export async function resetState(): Promise<void> {
  if (sharedHistory) {
    await sharedHistory.close();
  }
  sharedWorkingCopy = null;
  sharedGit = null;
  sharedHistory = null;
}

/**
 * Helper function to add a file to staging
 */
export async function addFileToStaging(
  workingCopy: WorkingCopy,
  path: string,
  content: string,
): Promise<string> {
  const data = new TextEncoder().encode(content);
  const objectId = await workingCopy.history.blobs.store([data]);

  const editor = workingCopy.checkout.staging.createEditor();
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

/**
 * Format a date from Unix timestamp
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().split("T")[0];
}

export type { Git } from "@statewalker/vcs-commands";
export type { WorkingCopy } from "@statewalker/vcs-core";
// Re-export types
export { FileMode } from "@statewalker/vcs-core";
