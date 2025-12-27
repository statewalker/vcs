/**
 * File-based StashStore implementation using Git's refs/stash.
 *
 * Design:
 * - Interface accessed via WorkingCopy.stash
 * - Storage: Central .git/refs/stash for Git compatibility
 * - Uses reflog for stash history (.git/logs/refs/stash)
 */

import type { ObjectId } from "../id/index.js";
import type { Repository } from "../repository.js";
import type { StashEntry, StashStore } from "../working-copy.js";

/**
 * Files API subset needed for stash operations
 */
export interface StashFilesApi {
  read(path: string): Promise<Uint8Array | undefined>;
  write(path: string, content: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

/**
 * Git-compatible stash store implementation.
 *
 * A stash commit has two parents:
 * - Parent 1: HEAD at time of stash
 * - Parent 2: Index state commit
 *
 * Tree contains working tree state.
 */
export class GitStashStore implements StashStore {
  constructor(
    readonly _repository: Repository,
    private readonly files: StashFilesApi,
    private readonly gitDir: string,
  ) {}

  /**
   * List all stash entries from reflog.
   * Entries are yielded in order (stash@{0} first).
   */
  async *list(): AsyncIterable<StashEntry> {
    const reflogPath = `${this.gitDir}/logs/refs/stash`;
    const content = await this.files.read(reflogPath);
    if (!content) return;

    const lines = new TextDecoder().decode(content).trim().split("\n");

    // Reflog entries are newest-last, so reverse for stash order
    for (let i = lines.length - 1; i >= 0; i--) {
      const entry = parseReflogEntry(lines[i], lines.length - 1 - i);
      if (entry) yield entry;
    }
  }

  /**
   * Push current changes to stash.
   *
   * Creates a special stash commit with:
   * - Tree: current working tree state
   * - Parent 1: current HEAD
   * - Parent 2: commit of current index state
   */
  async push(_message?: string): Promise<ObjectId> {
    // TODO: Full implementation requires:
    // 1. Create tree from working tree
    // 2. Create index state commit
    // 3. Create stash commit with special structure
    // 4. Update refs/stash
    // 5. Add reflog entry
    throw new Error("Not implemented: stash push");
  }

  /**
   * Pop most recent stash entry.
   * Applies stash@{0} and removes it.
   */
  async pop(): Promise<void> {
    await this.apply(0);
    await this.drop(0);
  }

  /**
   * Apply stash entry without removing it.
   */
  async apply(_index = 0): Promise<void> {
    // TODO: Full implementation requires:
    // 1. Get stash commit at index
    // 2. Apply tree to working directory
    // 3. Optionally restore index state
    throw new Error("Not implemented: stash apply");
  }

  /**
   * Drop a stash entry.
   */
  async drop(index = 0): Promise<void> {
    const reflogPath = `${this.gitDir}/logs/refs/stash`;
    const content = await this.files.read(reflogPath);
    if (!content) return;

    const lines = new TextDecoder().decode(content).trim().split("\n");
    const targetLine = lines.length - 1 - index;

    if (targetLine < 0 || targetLine >= lines.length) {
      throw new Error(`stash@{${index}} does not exist`);
    }

    // Remove the line
    lines.splice(targetLine, 1);

    if (lines.length === 0) {
      // No more stash entries, clean up
      await this.clear();
    } else {
      // Update reflog
      await this.files.write(reflogPath, new TextEncoder().encode(`${lines.join("\n")}\n`));

      // Update refs/stash to point to new top
      const topEntry = parseReflogEntry(lines[lines.length - 1], 0);
      if (topEntry) {
        await this.files.write(
          `${this.gitDir}/refs/stash`,
          new TextEncoder().encode(`${topEntry.commitId}\n`),
        );
      }
    }
  }

  /**
   * Clear all stash entries.
   */
  async clear(): Promise<void> {
    await this.files.remove(`${this.gitDir}/refs/stash`);
    await this.files.remove(`${this.gitDir}/logs/refs/stash`);
  }
}

/**
 * Parse a reflog entry line.
 *
 * Format: <old-sha> <new-sha> <author> <timestamp> <timezone>\t<message>
 */
function parseReflogEntry(line: string, index: number): StashEntry | undefined {
  if (!line.trim()) return undefined;

  const tabIndex = line.indexOf("\t");
  if (tabIndex === -1) return undefined;

  const header = line.substring(0, tabIndex);
  const message = line.substring(tabIndex + 1);

  const parts = header.split(" ");
  if (parts.length < 5) return undefined;

  const newSha = parts[1];
  const timestamp = parseInt(parts[parts.length - 2], 10);

  return {
    index,
    commitId: newSha,
    message: message.replace(/^stash@\{\d+\}:\s*/, ""),
    timestamp: timestamp * 1000, // Convert to milliseconds
  };
}

/**
 * Create a GitStashStore instance.
 */
export function createGitStashStore(
  repository: Repository,
  files: StashFilesApi,
  gitDir: string,
): StashStore {
  return new GitStashStore(repository, files, gitDir);
}
