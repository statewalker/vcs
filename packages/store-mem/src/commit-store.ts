/**
 * In-memory CommitStore implementation
 *
 * Provides a pure in-memory commit storage for testing and ephemeral operations.
 * No persistence - data is lost when the instance is garbage collected.
 *
 * Unlike file-based implementations, this does not use Git format serialization.
 * Commits are stored directly as JavaScript objects for simplicity and performance.
 */

import type { AncestryOptions, Commit, CommitStore, ObjectId } from "@webrun-vcs/core";

/**
 * Priority queue entry for commit traversal
 */
interface CommitEntry {
  id: ObjectId;
  timestamp: number;
}

/**
 * Simple hash function for generating deterministic object IDs.
 */
function computeCommitHash(commit: Commit): ObjectId {
  const content = JSON.stringify({
    tree: commit.tree,
    parents: commit.parents,
    author: commit.author,
    committer: commit.committer,
    message: commit.message,
    encoding: commit.encoding,
  });

  // Simple hash (FNV-1a inspired)
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `commit${hex}${"0".repeat(26)}`;
}

/**
 * Insert entry into queue maintaining timestamp order (newest first)
 */
function insertByTimestamp(queue: CommitEntry[], entry: CommitEntry): void {
  let low = 0;
  let high = queue.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    if (queue[mid].timestamp > entry.timestamp) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  queue.splice(low, 0, entry);
}

/**
 * In-memory CommitStore implementation.
 */
export class MemoryCommitStore implements CommitStore {
  private commits = new Map<ObjectId, Commit>();

  /**
   * Store a commit object.
   */
  async storeCommit(commit: Commit): Promise<ObjectId> {
    const id = computeCommitHash(commit);

    // Store a deep copy to prevent external mutation
    if (!this.commits.has(id)) {
      this.commits.set(id, {
        tree: commit.tree,
        parents: [...commit.parents],
        author: { ...commit.author },
        committer: { ...commit.committer },
        message: commit.message,
        encoding: commit.encoding,
        gpgSignature: commit.gpgSignature,
      });
    }

    return id;
  }

  /**
   * Load a commit object by ID.
   */
  async loadCommit(id: ObjectId): Promise<Commit> {
    const commit = this.commits.get(id);
    if (!commit) {
      throw new Error(`Commit ${id} not found`);
    }

    // Return a copy to prevent external mutation
    return {
      tree: commit.tree,
      parents: [...commit.parents],
      author: { ...commit.author },
      committer: { ...commit.committer },
      message: commit.message,
      encoding: commit.encoding,
      gpgSignature: commit.gpgSignature,
    };
  }

  /**
   * Get parent commit IDs.
   */
  async getParents(id: ObjectId): Promise<ObjectId[]> {
    const commit = await this.loadCommit(id);
    return commit.parents;
  }

  /**
   * Get the tree ObjectId for a commit.
   */
  async getTree(id: ObjectId): Promise<ObjectId> {
    const commit = await this.loadCommit(id);
    return commit.tree;
  }

  /**
   * Walk commit ancestry (depth-first with timestamp ordering).
   *
   * Traverses the commit graph from the starting commit(s),
   * yielding commits in reverse chronological order.
   */
  walkAncestry(
    startIds: ObjectId | ObjectId[],
    options: AncestryOptions = {},
  ): AsyncIterable<ObjectId> {
    return this.walkAncestryGenerator(startIds, options);
  }

  private async *walkAncestryGenerator(
    startIds: ObjectId | ObjectId[],
    options: AncestryOptions,
  ): AsyncGenerator<ObjectId> {
    const starts = Array.isArray(startIds) ? startIds : [startIds];
    const { limit, stopAt, firstParentOnly } = options;

    // Build stop set for quick lookup
    const stopSet = new Set(stopAt || []);

    // Priority queue ordered by timestamp (newest first)
    const queue: CommitEntry[] = [];
    const visited = new Set<ObjectId>();
    let count = 0;

    // Initialize queue with start commits
    for (const id of starts) {
      if (!visited.has(id) && !stopSet.has(id)) {
        visited.add(id);
        try {
          const commit = await this.loadCommit(id);
          insertByTimestamp(queue, { id, timestamp: commit.committer.timestamp });
        } catch {
          // Skip missing commits
        }
      }
    }

    // Process queue
    while (queue.length > 0) {
      if (limit !== undefined && count >= limit) {
        break;
      }

      const entry = queue.shift();
      if (!entry) break;
      yield entry.id;
      count++;

      // Add parents to queue
      const commit = await this.loadCommit(entry.id);
      const parents = firstParentOnly ? commit.parents.slice(0, 1) : commit.parents;

      for (const parentId of parents) {
        if (!visited.has(parentId) && !stopSet.has(parentId)) {
          visited.add(parentId);
          try {
            const parent = await this.loadCommit(parentId);
            insertByTimestamp(queue, {
              id: parentId,
              timestamp: parent.committer.timestamp,
            });
          } catch {
            // Skip missing parents
          }
        }
      }
    }
  }

  /**
   * Find merge base (common ancestor).
   *
   * Uses the standard algorithm to find best common ancestor(s).
   */
  async findMergeBase(commitA: ObjectId, commitB: ObjectId): Promise<ObjectId[]> {
    // Paint ancestors of commitA with color A
    const colorA = new Set<ObjectId>();

    for await (const id of this.walkAncestry(commitA)) {
      colorA.add(id);
    }

    // Walk ancestors of B and find intersections
    const mergeBases: ObjectId[] = [];

    for await (const id of this.walkAncestry(commitB)) {
      if (colorA.has(id)) {
        // Found a common ancestor
        // Check if it's not an ancestor of another merge base
        let isRedundant = false;
        for (const base of mergeBases) {
          if (await this.isAncestor(id, base)) {
            isRedundant = true;
            break;
          }
        }

        if (!isRedundant) {
          // Remove any existing merge bases that are ancestors of this one
          const filtered: ObjectId[] = [];
          for (const base of mergeBases) {
            if (!(await this.isAncestor(base, id))) {
              filtered.push(base);
            }
          }
          filtered.push(id);
          mergeBases.length = 0;
          mergeBases.push(...filtered);
        }
      }
    }

    return mergeBases;
  }

  /**
   * Check if commit exists.
   */
  async hasCommit(id: ObjectId): Promise<boolean> {
    return this.commits.has(id);
  }

  /**
   * Check if ancestorId is ancestor of descendantId.
   */
  async isAncestor(ancestorId: ObjectId, descendantId: ObjectId): Promise<boolean> {
    if (ancestorId === descendantId) {
      return true;
    }

    // Walk from descendant looking for ancestor
    for await (const id of this.walkAncestry(descendantId)) {
      if (id === ancestorId) {
        return true;
      }
    }

    return false;
  }
}
