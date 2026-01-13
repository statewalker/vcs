/**
 * In-memory CommitStore implementation
 *
 * Provides a pure in-memory commit storage for testing and ephemeral operations.
 * No persistence - data is lost when the instance is garbage collected.
 *
 * Unlike file-based implementations, this does not use Git format serialization.
 * Commits are stored directly as JavaScript objects for simplicity and performance.
 */

import type { AncestryOptions, Commit, CommitStore, ObjectId } from "@statewalker/vcs-core";
import {
  computeCommitHash,
  findMergeBase as findMergeBaseShared,
  isAncestor as isAncestorShared,
  walkAncestry as walkAncestryShared,
} from "@statewalker/vcs-core";

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
    return walkAncestryShared(this, startIds, options);
  }

  /**
   * Find merge base (common ancestor).
   *
   * Uses the standard algorithm to find best common ancestor(s).
   */
  async findMergeBase(commitA: ObjectId, commitB: ObjectId): Promise<ObjectId[]> {
    return findMergeBaseShared(this, commitA, commitB);
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
    return isAncestorShared(this, ancestorId, descendantId);
  }
}
