/**
 * KV-based CommitStore implementation
 *
 * Stores commit objects using a key-value backend with JSON serialization.
 */

import type { AncestryOptions, Commit, CommitStore, ObjectId } from "@statewalker/vcs-core";
import {
  computeCommitHash,
  findMergeBase as findMergeBaseShared,
  isAncestor as isAncestorShared,
  walkAncestry as walkAncestryShared,
} from "@statewalker/vcs-core";

import type { KVStore } from "./kv-store.js";

/**
 * Key prefix for commit data
 */
const COMMIT_PREFIX = "commit:";

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
  async has(id: ObjectId): Promise<boolean> {
    return this.kv.has(`${COMMIT_PREFIX}${id}`);
  }

  /**
   * Enumerate all commit object IDs.
   */
  async *keys(): AsyncIterable<ObjectId> {
    for await (const key of this.kv.list(COMMIT_PREFIX)) {
      yield key.slice(COMMIT_PREFIX.length);
    }
  }

  /**
   * Check if ancestorId is ancestor of descendantId.
   */
  async isAncestor(ancestorId: ObjectId, descendantId: ObjectId): Promise<boolean> {
    return isAncestorShared(this, ancestorId, descendantId);
  }
}
