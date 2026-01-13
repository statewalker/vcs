/**
 * KV-based CommitStore implementation
 *
 * Stores commit objects using a key-value backend with JSON serialization.
 */

import type { AncestryOptions, Commit, CommitStore, ObjectId } from "@statewalker/vcs-core";
import { computeCommitHash } from "@statewalker/vcs-core";
import { insertByTimestamp, type TimestampEntry } from "@statewalker/vcs-utils";

import type { KVStore } from "./kv-store.js";

/**
 * Key prefix for commit data
 */
const COMMIT_PREFIX = "commit:";

/**
 * Priority queue entry for commit traversal
 */
interface CommitEntry extends TimestampEntry {
  id: ObjectId;
}

/**
 * Serialized commit format
 */
interface SerializedCommit {
  t: string; // tree
  p: string[]; // parents
  an: string; // author name
  ae: string; // author email
  at: number; // author timestamp
  az: string; // author tzOffset
  cn: string; // committer name
  ce: string; // committer email
  ct: number; // committer timestamp
  cz: string; // committer tzOffset
  m: string; // message
  e?: string; // encoding
  g?: string; // gpgSignature
}

/**
 * Text encoder/decoder for JSON serialization
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * KV-based CommitStore implementation.
 */
export class KVCommitStore implements CommitStore {
  constructor(private kv: KVStore) {}

  /**
   * Store a commit object.
   */
  async storeCommit(commit: Commit): Promise<ObjectId> {
    const commitId = computeCommitHash(commit);

    // Check if commit already exists (deduplication)
    if (await this.kv.has(`${COMMIT_PREFIX}${commitId}`)) {
      return commitId;
    }

    // Serialize
    const serialized: SerializedCommit = {
      t: commit.tree,
      p: commit.parents,
      an: commit.author.name,
      ae: commit.author.email,
      at: commit.author.timestamp,
      az: commit.author.tzOffset,
      cn: commit.committer.name,
      ce: commit.committer.email,
      ct: commit.committer.timestamp,
      cz: commit.committer.tzOffset,
      m: commit.message,
      e: commit.encoding,
      g: commit.gpgSignature,
    };

    await this.kv.set(`${COMMIT_PREFIX}${commitId}`, encoder.encode(JSON.stringify(serialized)));

    return commitId;
  }

  /**
   * Load a commit object by ID.
   */
  async loadCommit(id: ObjectId): Promise<Commit> {
    const data = await this.kv.get(`${COMMIT_PREFIX}${id}`);
    if (!data) {
      throw new Error(`Commit ${id} not found`);
    }

    const s: SerializedCommit = JSON.parse(decoder.decode(data));

    return {
      tree: s.t,
      parents: s.p,
      author: {
        name: s.an,
        email: s.ae,
        timestamp: s.at,
        tzOffset: s.az,
      },
      committer: {
        name: s.cn,
        email: s.ce,
        timestamp: s.ct,
        tzOffset: s.cz,
      },
      message: s.m,
      encoding: s.e,
      gpgSignature: s.g,
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
    return this.walkAncestryGenerator(startIds, options);
  }

  private async *walkAncestryGenerator(
    startIds: ObjectId | ObjectId[],
    options: AncestryOptions,
  ): AsyncGenerator<ObjectId> {
    const starts = Array.isArray(startIds) ? startIds : [startIds];
    const { limit, stopAt, firstParentOnly } = options;

    const stopSet = new Set(stopAt || []);
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
   * Check if commit exists.
   */
  async hasCommit(id: ObjectId): Promise<boolean> {
    return this.kv.has(`${COMMIT_PREFIX}${id}`);
  }

  /**
   * Check if ancestorId is ancestor of descendantId.
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
}
