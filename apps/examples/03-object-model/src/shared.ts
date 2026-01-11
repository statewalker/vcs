/**
 * Shared utilities for the object model example
 */

import {
  createGitRepository,
  createInMemoryFilesApi,
  FileMode,
  type FilesApi,
  type GitRepository,
  type ObjectId,
} from "@statewalker/vcs-core";

// Shared state
let sharedFiles: FilesApi | null = null;
let sharedRepository: GitRepository | null = null;

/**
 * Get or create the shared repository
 */
export async function getRepository(): Promise<{ repository: GitRepository; files: FilesApi }> {
  if (!sharedFiles || !sharedRepository) {
    sharedFiles = createInMemoryFilesApi();
    sharedRepository = await createGitRepository(sharedFiles, ".git", {
      create: true,
      defaultBranch: "main",
    });
  }
  return { repository: sharedRepository, files: sharedFiles };
}

/**
 * Reset the shared state
 */
export function resetState(): void {
  sharedFiles = null;
  sharedRepository = null;
}

/**
 * Store text content as a blob
 */
export async function storeBlob(repository: GitRepository, content: string): Promise<ObjectId> {
  const bytes = new TextEncoder().encode(content);
  return repository.blobs.store([bytes]);
}

/**
 * Read blob content as text
 */
export async function readBlob(repository: GitRepository, id: ObjectId): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of repository.blobs.load(id)) {
    chunks.push(chunk);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}

/**
 * Format ObjectId for display
 */
export function shortId(id: string): string {
  return id.slice(0, 7);
}

/**
 * Get string representation of file mode
 */
export function getModeString(mode: number): string {
  switch (mode) {
    case FileMode.TREE:
      return "040000";
    case FileMode.REGULAR_FILE:
      return "100644";
    case FileMode.EXECUTABLE_FILE:
      return "100755";
    case FileMode.SYMLINK:
      return "120000";
    case FileMode.GITLINK:
      return "160000";
    default:
      return mode.toString(8).padStart(6, "0");
  }
}

/**
 * Get type name for file mode
 */
export function getModeType(mode: number): string {
  switch (mode) {
    case FileMode.TREE:
      return "tree";
    case FileMode.REGULAR_FILE:
    case FileMode.EXECUTABLE_FILE:
      return "blob";
    case FileMode.SYMLINK:
      return "link";
    case FileMode.GITLINK:
      return "submodule";
    default:
      return "unknown";
  }
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
 * Print a subsection header
 */
export function printSubsection(title: string): void {
  console.log(`\n  >> ${title}`);
}

export type { GitRepository, ObjectId, TreeEntry } from "@statewalker/vcs-core";
// Re-export types
export { FileMode } from "@statewalker/vcs-core";
