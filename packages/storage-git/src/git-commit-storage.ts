/**
 * Git commit storage implementation
 *
 * Manages commit objects with graph traversal capabilities.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/revwalk/RevWalk.java
 */

import type { AncestryOptions, Commit, CommitStore, ObjectId } from "@webrun-vcs/core";
import { ObjectType } from "@webrun-vcs/core";
import { parseCommit, serializeCommit } from "./format/commit-format.js";
import type { LooseObjectStorage } from "./git-delta-object-storage.js";
import { loadTypedObject, storeTypedObject } from "./typed-object-utils.js";

/**
 * Priority queue entry for commit traversal
 */
interface CommitEntry {
  id: ObjectId;
  timestamp: number;
}

/**
 * Git commit storage implementation
 *
 * Implements CommitStore with graph traversal capabilities.
 */
export class GitCommitStorage implements CommitStore {
  private readonly rawStorage: LooseObjectStorage;

  constructor(rawStorage: LooseObjectStorage) {
    this.rawStorage = rawStorage;
  }

  /**
   * Store a commit object
   */
  async storeCommit(commit: Commit): Promise<ObjectId> {
    const content = serializeCommit(commit);
    return storeTypedObject(this.rawStorage, ObjectType.COMMIT, content);
  }

  /**
   * Load a commit object by ID
   */
  async loadCommit(id: ObjectId): Promise<Commit> {
    const obj = await loadTypedObject(this.rawStorage, id);

    if (obj.type !== ObjectType.COMMIT) {
      throw new Error(`Expected commit object, got type ${obj.type}`);
    }

    return parseCommit(obj.content);
  }

  /**
   * Get parent commit IDs
   */
  async getParents(id: ObjectId): Promise<ObjectId[]> {
    const commit = await this.loadCommit(id);
    return commit.parents;
  }

  /**
   * Get the tree ObjectId for a commit
   */
  async getTree(id: ObjectId): Promise<ObjectId> {
    const commit = await this.loadCommit(id);
    return commit.tree;
  }

  /**
   * Walk commit ancestry (depth-first with timestamp ordering)
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
        const commit = await this.loadCommit(id);
        insertByTimestamp(queue, { id, timestamp: commit.committer.timestamp });
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
   * Find merge base (common ancestor)
   *
   * Uses the standard algorithm to find best common ancestor(s).
   */
  async findMergeBase(commitA: ObjectId, commitB: ObjectId): Promise<ObjectId[]> {
    // Paint ancestors of commitA with color A
    // Paint ancestors of commitB with color B
    // Find commits painted with both colors

    const colorA = new Set<ObjectId>();
    const colorB = new Set<ObjectId>();

    // Walk ancestors of A
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

        // Stop if we've found enough (optimization for single merge base case)
        // For octopus merges, we might need multiple bases
        colorB.add(id);
      }
    }

    return mergeBases;
  }

  /**
   * Check if commit exists
   */
  async hasCommit(id: ObjectId): Promise<boolean> {
    return this.rawStorage.has(id);
  }

  /**
   * Check if ancestorId is ancestor of descendantId
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

/**
 * Insert entry into queue maintaining timestamp order (newest first)
 */
function insertByTimestamp(queue: CommitEntry[], entry: CommitEntry): void {
  // Binary search for insertion point
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
