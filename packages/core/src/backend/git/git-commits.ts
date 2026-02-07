/**
 * Git commit store implementation
 *
 * Wraps GitObjectStore with commit serialization/deserialization.
 * Provides graph traversal operations for commit history.
 *
 * @module
 */

import type { ObjectId } from "../../common/id/index.js";
import {
  commitToEntries,
  decodeCommitEntries,
  encodeCommitEntries,
  entriesToCommit,
} from "../../history/commits/commit-format.js";
import type { AncestryOptions, Commit, Commits } from "../../history/commits/commits.js";
import type { GitObjectStore } from "../../history/objects/object-store.js";

/**
 * Git commit store implementation
 *
 * Wraps GitObjectStore to provide commit-specific operations.
 * Implements the Commits interface for use with History.
 */
export class GitCommits implements Commits {
  constructor(private readonly objects: GitObjectStore) {}

  /**
   * Store a commit object
   *
   * @param commit Commit data
   * @returns ObjectId (SHA-1 hash)
   */
  async store(commit: Commit): Promise<ObjectId> {
    const entries = commitToEntries(commit);
    return this.objects.store("commit", encodeCommitEntries(entries));
  }

  /**
   * Load a commit object by ID
   *
   * Returns undefined if commit doesn't exist.
   *
   * @param id Commit object ID
   * @returns Commit data if found, undefined otherwise
   */
  async load(id: ObjectId): Promise<Commit | undefined> {
    if (!(await this.objects.has(id))) {
      return undefined;
    }
    try {
      return await this.loadCommitInternal(id);
    } catch {
      return undefined;
    }
  }

  /**
   * Remove commit from storage
   *
   * @param id Commit object ID
   * @returns True if removed, false if didn't exist
   */
  remove(id: ObjectId): Promise<boolean> {
    return this.objects.remove(id);
  }

  /**
   * Load a commit object by ID (internal implementation)
   */
  private async loadCommitInternal(id: ObjectId): Promise<Commit> {
    const [header, content] = await this.objects.loadWithHeader(id);
    try {
      if (header.type !== "commit") {
        throw new Error(`Object ${id} is not a commit (found type: ${header.type})`);
      }
      const entries = decodeCommitEntries(content);
      return entriesToCommit(entries);
    } catch (err) {
      content?.return?.(void 0);
      throw err;
    }
  }

  /**
   * Get parent commit IDs
   *
   * @param id Commit object ID
   * @returns Array of parent commit IDs
   */
  async getParents(id: ObjectId): Promise<ObjectId[]> {
    const commit = await this.loadCommitInternal(id);
    return commit.parents;
  }

  /**
   * Get tree ID for a commit
   *
   * @param id Commit object ID
   * @returns Tree ID if commit exists, undefined otherwise
   */
  async getTree(id: ObjectId): Promise<ObjectId | undefined> {
    const commit = await this.load(id);
    return commit?.tree;
  }

  /**
   * Walk commit ancestry (depth-first)
   *
   * @param startIds Starting commit ID(s)
   * @param options Walk options
   * @yields Commit IDs in ancestry order
   */
  async *walkAncestry(
    startIds: ObjectId | ObjectId[],
    options: AncestryOptions = {},
  ): AsyncIterable<ObjectId> {
    const starts = Array.isArray(startIds) ? startIds : [startIds];
    const visited = new Set<ObjectId>();
    const stopAt = new Set(options.stopAt || []);
    const stack = [...starts];
    let count = 0;

    while (stack.length > 0) {
      if (options.limit !== undefined && count >= options.limit) {
        break;
      }

      const id = stack.pop();
      if (id === undefined) break;

      if (visited.has(id) || stopAt.has(id)) {
        continue;
      }

      visited.add(id);
      yield id;
      count++;

      const parents = await this.getParents(id);
      if (options.firstParentOnly && parents.length > 0) {
        stack.push(parents[0]);
      } else {
        for (let i = parents.length - 1; i >= 0; i--) {
          stack.push(parents[i]);
        }
      }
    }
  }

  /**
   * Find merge base (common ancestor)
   *
   * @param commitA First commit ID
   * @param commitB Second commit ID
   * @returns Array of common ancestor IDs
   */
  async findMergeBase(commitA: ObjectId, commitB: ObjectId): Promise<ObjectId[]> {
    const ancestorsA = new Set<ObjectId>();

    for await (const id of this.walkAncestry(commitA)) {
      ancestorsA.add(id);
    }

    for await (const id of this.walkAncestry(commitB)) {
      if (ancestorsA.has(id)) {
        return [id];
      }
    }

    return [];
  }

  /**
   * Check if commit exists and is actually a commit object
   *
   * @param id Object ID
   * @returns True if object exists and is a commit
   */
  async has(id: ObjectId): Promise<boolean> {
    if (!(await this.objects.has(id))) {
      return false;
    }
    try {
      const header = await this.objects.getHeader(id);
      return header.type === "commit";
    } catch {
      return false;
    }
  }

  /**
   * Iterate over all commit object IDs
   *
   * @returns AsyncIterable of commit ObjectIds
   */
  async *keys(): AsyncIterable<ObjectId> {
    for await (const id of this.objects.list()) {
      try {
        const header = await this.objects.getHeader(id);
        if (header.type === "commit") {
          yield id;
        }
      } catch {
        // Skip invalid objects
      }
    }
  }

  /**
   * Check if commitA is ancestor of commitB
   *
   * @param ancestorId Potential ancestor commit
   * @param descendantId Potential descendant commit
   * @returns True if ancestorId is in descendantId's history
   */
  async isAncestor(ancestorId: ObjectId, descendantId: ObjectId): Promise<boolean> {
    for await (const id of this.walkAncestry(descendantId)) {
      if (id === ancestorId) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Create a GitCommits instance
 *
 * @param objects GitObjectStore to wrap
 * @returns GitCommits instance
 */
export function createGitCommits(objects: GitObjectStore): Commits {
  return new GitCommits(objects);
}
