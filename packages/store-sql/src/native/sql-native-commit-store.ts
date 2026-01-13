/**
 * Native SQL CommitStore with Git-compatible IDs and query capabilities
 *
 * Stores commits in normalized SQL tables while computing SHA-1 hashes
 * identical to native Git. Provides extended query methods for efficient
 * lookups by author, date range, and ancestry.
 */

import {
  type AncestryOptions,
  type Commit,
  commitToEntries,
  computeCommitSize,
  encodeCommitEntries,
  encodeObjectHeader,
  type ObjectId,
  type PersonIdent,
} from "@statewalker/vcs-core";
import { bytesToHex, insertByTimestamp, Sha1, type TimestampEntry } from "@statewalker/vcs-utils";

import type { DatabaseClient } from "../database-client.js";
import type { SqlNativeCommitStore } from "./types.js";

/**
 * Priority queue entry for commit traversal
 */
interface CommitQueueEntry extends TimestampEntry {
  id: ObjectId;
}

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
 * Compute Git-compatible SHA-1 hash for a commit
 *
 * Uses the VCS format functions to serialize the commit to Git format,
 * then computes SHA-1 of "commit {size}\0{content}".
 */
async function computeGitCommitId(commit: Commit): Promise<ObjectId> {
  const entries = Array.from(commitToEntries(commit));
  const size = await computeCommitSize(entries);

  const sha1 = new Sha1();
  sha1.update(encodeObjectHeader("commit", size));

  for await (const chunk of encodeCommitEntries(entries)) {
    sha1.update(chunk);
  }

  return bytesToHex(sha1.finalize());
}

/**
 * Native SQL CommitStore implementation
 *
 * Uses normalized tables:
 * - vcs_commit: Commit metadata
 * - commit_parent: Parent references with position ordering
 *
 * Computes Git-compatible SHA-1 object IDs for interoperability.
 */
export class SqlNativeCommitStoreImpl implements SqlNativeCommitStore {
  constructor(private db: DatabaseClient) {}

  /**
   * Store a commit object with Git-compatible ID
   */
  async storeCommit(commit: Commit): Promise<ObjectId> {
    const commitId = await computeGitCommitId(commit);

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
   * Load a commit object by ID
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

    const author: PersonIdent = {
      name: row.author_name,
      email: row.author_email,
      timestamp: row.author_timestamp,
      tzOffset: row.author_tz,
    };

    const committer: PersonIdent = {
      name: row.committer_name,
      email: row.committer_email,
      timestamp: row.committer_timestamp,
      tzOffset: row.committer_tz,
    };

    const commit: Commit = {
      tree: row.tree_id,
      parents: parents.map((p) => p.parent_id),
      author,
      committer,
      message: row.message,
    };

    if (row.encoding) {
      commit.encoding = row.encoding;
    }

    if (row.gpg_signature) {
      commit.gpgSignature = row.gpg_signature;
    }

    return commit;
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

    const stopSet = new Set(stopAt || []);
    const queue: CommitQueueEntry[] = [];
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
   * Find merge base (common ancestor)
   */
  async findMergeBase(commitA: ObjectId, commitB: ObjectId): Promise<ObjectId[]> {
    // Paint ancestors of commitA
    const colorA = new Set<ObjectId>();

    for await (const id of this.walkAncestry(commitA)) {
      colorA.add(id);
    }

    // Walk ancestors of B and find intersections
    const mergeBases: ObjectId[] = [];

    for await (const id of this.walkAncestry(commitB)) {
      if (colorA.has(id)) {
        // Found a common ancestor
        let isRedundant = false;
        for (const base of mergeBases) {
          if (await this.isAncestor(id, base)) {
            isRedundant = true;
            break;
          }
        }

        if (!isRedundant) {
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
   * Check if commit exists
   */
  async hasCommit(id: ObjectId): Promise<boolean> {
    const result = await this.db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM vcs_commit WHERE commit_id = ?",
      [id],
    );
    return result[0].cnt > 0;
  }

  /**
   * Check if ancestorId is ancestor of descendantId
   */
  async isAncestor(ancestorId: ObjectId, descendantId: ObjectId): Promise<boolean> {
    if (ancestorId === descendantId) {
      return true;
    }

    for await (const id of this.walkAncestry(descendantId)) {
      if (id === ancestorId) {
        return true;
      }
    }

    return false;
  }

  // --- Extended query methods ---

  /**
   * Find commits by author email
   */
  async *findByAuthor(email: string): AsyncIterable<ObjectId> {
    const rows = await this.db.query<{ commit_id: string }>(
      "SELECT commit_id FROM vcs_commit WHERE author_email = ? ORDER BY author_timestamp DESC",
      [email],
    );
    for (const row of rows) {
      yield row.commit_id;
    }
  }

  /**
   * Find commits in a date range
   */
  async *findByDateRange(since: Date, until: Date): AsyncIterable<ObjectId> {
    const rows = await this.db.query<{ commit_id: string }>(
      `SELECT commit_id FROM vcs_commit
       WHERE author_timestamp BETWEEN ? AND ?
       ORDER BY author_timestamp DESC`,
      [Math.floor(since.getTime() / 1000), Math.floor(until.getTime() / 1000)],
    );
    for (const row of rows) {
      yield row.commit_id;
    }
  }

  /**
   * Get all ancestors using recursive CTE
   */
  async *getAncestors(id: ObjectId): AsyncIterable<ObjectId> {
    // First get the internal ID for the starting commit
    const commits = await this.db.query<{ id: number }>(
      "SELECT id FROM vcs_commit WHERE commit_id = ?",
      [id],
    );

    if (commits.length === 0) {
      throw new Error(`Commit ${id} not found`);
    }

    const commitFk = commits[0].id;

    const rows = await this.db.query<{ parent_id: string }>(
      `WITH RECURSIVE ancestry AS (
        SELECT parent_id, commit_fk FROM commit_parent WHERE commit_fk = ?
        UNION
        SELECT cp.parent_id, cp.commit_fk FROM commit_parent cp
        INNER JOIN vcs_commit c ON c.commit_id = cp.parent_id
        INNER JOIN ancestry a ON c.id = a.commit_fk
      )
      SELECT DISTINCT parent_id FROM ancestry`,
      [commitFk],
    );

    for (const row of rows) {
      yield row.parent_id;
    }
  }

  /**
   * Get commit count
   */
  async count(): Promise<number> {
    const result = await this.db.query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM vcs_commit");
    return result[0].cnt;
  }
}
