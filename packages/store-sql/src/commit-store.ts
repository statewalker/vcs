/**
 * SQL-based CommitStore implementation
 *
 * Stores commit objects in a normalized SQL schema with separate
 * tables for commits and their parent references.
 */

import type { AncestryOptions, Commit, CommitStore, ObjectId } from "@statewalker/vcs-core";
import {
  computeCommitHash,
  findMergeBase as findMergeBaseShared,
  isAncestor as isAncestorShared,
  walkAncestry as walkAncestryShared,
} from "@statewalker/vcs-core";

import type { DatabaseClient } from "./database-client.js";

/**
 * Database row type for commit queries
 */
interface CommitRow {
  id: number;
  commit_id: string;
  tree_id: string;
  author_name: string;
  author_email: string;
  author_timestamp: number;
  author_tz: string;
  committer_name: string;
  committer_email: string;
  committer_timestamp: number;
  committer_tz: string;
  message: string;
  encoding: string | null;
  gpg_signature: string | null;
}

/**
 * SQL-based CommitStore implementation.
 *
 * Uses normalized tables:
 * - vcs_commit: Commit metadata
 * - commit_parent: Parent references with position ordering
 */
export class SQLCommitStore implements CommitStore {
  constructor(private db: DatabaseClient) {}

  /**
   * Store a commit object.
   */
  async storeCommit(commit: Commit): Promise<ObjectId> {
    const commitId = computeCommitHash(commit);

    // Check if commit already exists (deduplication)
    const existing = await this.db.query<{ id: number }>(
      "SELECT id FROM vcs_commit WHERE commit_id = ?",
      [commitId],
    );

    if (existing.length > 0) {
      return commitId;
    }

    // Store commit and parents in a transaction
    await this.db.transaction(async (tx) => {
      const now = Date.now();
      const result = await tx.execute(
        `INSERT INTO vcs_commit (
          commit_id, tree_id,
          author_name, author_email, author_timestamp, author_tz,
          committer_name, committer_email, committer_timestamp, committer_tz,
          message, encoding, gpg_signature, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          commitId,
          commit.tree,
          commit.author.name,
          commit.author.email,
          commit.author.timestamp,
          commit.author.tzOffset,
          commit.committer.name,
          commit.committer.email,
          commit.committer.timestamp,
          commit.committer.tzOffset,
          commit.message,
          commit.encoding || null,
          commit.gpgSignature || null,
          now,
        ],
      );

      const commitFk = result.lastInsertRowId;

      // Insert parent references with position
      for (let i = 0; i < commit.parents.length; i++) {
        await tx.execute(
          "INSERT INTO commit_parent (commit_fk, position, parent_id) VALUES (?, ?, ?)",
          [commitFk, i, commit.parents[i]],
        );
      }
    });

    return commitId;
  }

  /**
   * Load a commit object by ID.
   */
  async loadCommit(id: ObjectId): Promise<Commit> {
    const commits = await this.db.query<CommitRow>("SELECT * FROM vcs_commit WHERE commit_id = ?", [
      id,
    ]);

    if (commits.length === 0) {
      throw new Error(`Commit ${id} not found`);
    }

    const row = commits[0];

    // Load parents
    const parents = await this.db.query<{ parent_id: string }>(
      "SELECT parent_id FROM commit_parent WHERE commit_fk = ? ORDER BY position",
      [row.id],
    );

    return {
      tree: row.tree_id,
      parents: parents.map((p) => p.parent_id),
      author: {
        name: row.author_name,
        email: row.author_email,
        timestamp: row.author_timestamp,
        tzOffset: row.author_tz,
      },
      committer: {
        name: row.committer_name,
        email: row.committer_email,
        timestamp: row.committer_timestamp,
        tzOffset: row.committer_tz,
      },
      message: row.message,
      encoding: row.encoding || undefined,
      gpgSignature: row.gpg_signature || undefined,
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
   */
  walkAncestry(
    startIds: ObjectId | ObjectId[],
    options: AncestryOptions = {},
  ): AsyncIterable<ObjectId> {
    return walkAncestryShared(this, startIds, options);
  }

  /**
   * Find merge base (common ancestor).
   */
  async findMergeBase(commitA: ObjectId, commitB: ObjectId): Promise<ObjectId[]> {
    return findMergeBaseShared(this, commitA, commitB);
  }

  /**
   * Check if commit exists.
   */
  async hasCommit(id: ObjectId): Promise<boolean> {
    const result = await this.db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM vcs_commit WHERE commit_id = ?",
      [id],
    );
    return result[0].cnt > 0;
  }

  /**
   * Check if ancestorId is ancestor of descendantId.
   */
  async isAncestor(ancestorId: ObjectId, descendantId: ObjectId): Promise<boolean> {
    return isAncestorShared(this, ancestorId, descendantId);
  }
}
