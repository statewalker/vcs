/**
 * Commits implementation using GitObjectStore
 *
 * This implementation wraps GitObjectStore for commit storage,
 * ensuring Git-compatible format and SHA-1 computation.
 */

import type { ObjectId } from "../../common/id/index.js";
import type { GitObjectStore } from "../objects/object-store.js";
import {
  commitToEntries,
  decodeCommitEntries,
  encodeCommitEntries,
  entriesToCommit,
} from "./commit-format.js";
import type { Commit } from "./commit-store.js";
import type { Commits, WalkOptions } from "./commits.js";

/**
 * Storage-agnostic Commits implementation using GitObjectStore
 *
 * Stores commits in Git binary format for compatibility with
 * transport layer and SHA-1 computation.
 */
export class CommitsImpl implements Commits {
  constructor(private readonly objects: GitObjectStore) {}

  /**
   * Store a commit
   *
   * @param commit Commit data
   * @returns ObjectId of the stored commit
   */
  async store(commit: Commit): Promise<ObjectId> {
    const entries = commitToEntries(commit);
    return this.objects.store("commit", encodeCommitEntries(entries));
  }

  /**
   * Load a commit by ID
   *
   * @param id Commit object ID
   * @returns Commit data if found, undefined otherwise
   */
  async load(id: ObjectId): Promise<Commit | undefined> {
    if (!(await this.objects.has(id))) {
      return undefined;
    }

    const [header, content] = await this.objects.loadWithHeader(id);
    try {
      if (header.type !== "commit") {
        // Not a commit, close the stream
        await content?.return?.(void 0);
        return undefined;
      }
      const entries = decodeCommitEntries(content);
      return entriesToCommit(entries);
    } catch {
      await content?.return?.(void 0);
      return undefined;
    }
  }

  /**
   * Check if commit exists
   *
   * @param id Commit object ID
   * @returns True if commit exists
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
   * Remove a commit
   *
   * @param id Commit object ID
   * @returns True if commit was removed, false if it didn't exist
   */
  remove(id: ObjectId): Promise<boolean> {
    return this.objects.remove(id);
  }

  /**
   * Iterate over all stored commit IDs
   *
   * @returns AsyncIterable of all commit object IDs
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
   * Get parent commit IDs
   *
   * @param commitId Commit object ID
   * @returns Array of parent commit IDs (empty for root commits)
   */
  async getParents(commitId: ObjectId): Promise<ObjectId[]> {
    const commit = await this.load(commitId);
    return commit?.parents ?? [];
  }

  /**
   * Get tree ID for a commit
   *
   * @param commitId Commit object ID
   * @returns Tree ID if commit exists, undefined otherwise
   */
  async getTree(commitId: ObjectId): Promise<ObjectId | undefined> {
    const commit = await this.load(commitId);
    return commit?.tree;
  }

  /**
   * Walk commit ancestry
   *
   * Traverses the commit graph from a starting point in reverse chronological order.
   *
   * @param startId Starting commit ID (or array of IDs)
   * @param options Walk options (limit, stopAt, firstParentOnly)
   * @returns AsyncIterable of commit IDs
   */
  async *walkAncestry(
    startId: ObjectId | ObjectId[],
    options?: WalkOptions,
  ): AsyncIterable<ObjectId> {
    const starts = Array.isArray(startId) ? startId : [startId];
    const visited = new Set<ObjectId>();
    const stopAt = new Set(options?.stopAt ?? []);
    const stack = [...starts];
    let count = 0;

    while (stack.length > 0) {
      if (options?.limit !== undefined && count >= options.limit) {
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
      if (options?.firstParentOnly && parents.length > 0) {
        stack.push(parents[0]);
      } else {
        // Add parents in reverse order so first parent is processed first
        for (let i = parents.length - 1; i >= 0; i--) {
          stack.push(parents[i]);
        }
      }
    }
  }

  /**
   * Find merge base between two commits
   *
   * Returns the most recent common ancestor(s) of two commits,
   * or empty array if they share no common history.
   *
   * @param commit1 First commit ID
   * @param commit2 Second commit ID
   * @returns Array of merge base commit IDs
   */
  async findMergeBase(commit1: ObjectId, commit2: ObjectId): Promise<ObjectId[]> {
    // Collect ancestors of commit1
    const ancestors1 = new Set<ObjectId>();
    for await (const id of this.walkAncestry(commit1)) {
      ancestors1.add(id);
    }

    // Find first common ancestor in commit2's history
    for await (const id of this.walkAncestry(commit2)) {
      if (ancestors1.has(id)) {
        return [id];
      }
    }

    return [];
  }

  /**
   * Check if one commit is an ancestor of another
   *
   * @param ancestor Potential ancestor commit ID
   * @param descendant Potential descendant commit ID
   * @returns True if ancestor is reachable from descendant
   */
  async isAncestor(ancestor: ObjectId, descendant: ObjectId): Promise<boolean> {
    // A commit is not its own ancestor
    if (ancestor === descendant) {
      return false;
    }

    for await (const id of this.walkAncestry(descendant)) {
      if (id === ancestor) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Create a Commits instance backed by GitObjectStore
 *
 * @param objects GitObjectStore implementation to use for persistence
 * @returns Commits instance
 */
export function createCommits(objects: GitObjectStore): Commits {
  return new CommitsImpl(objects);
}
