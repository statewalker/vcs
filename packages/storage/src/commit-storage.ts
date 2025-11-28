import type { ObjectId, PersonIdent } from "./types.js";

/**
 * Commit object
 *
 * Following Git's commit format (JGit RevCommit):
 * - tree: SHA-1 of the root tree
 * - parents: Array of parent commit SHA-1s (empty for initial commit)
 * - author: Person who authored the changes
 * - committer: Person who committed (may differ from author)
 * - message: Commit message (UTF-8)
 *
 * Optional fields:
 * - encoding: Character encoding if not UTF-8
 * - gpgSignature: GPG signature if signed
 */
export interface Commit {
  /** ObjectId of the root tree */
  tree: ObjectId;
  /** Parent commit ObjectIds (empty array for initial commit) */
  parents: ObjectId[];
  /** Author identity */
  author: PersonIdent;
  /** Committer identity */
  committer: PersonIdent;
  /** Commit message (UTF-8) */
  message: string;
  /** Character encoding (optional, defaults to UTF-8) */
  encoding?: string;
  /** GPG signature (optional) */
  gpgSignature?: string;
}

/**
 * Commit ancestry traversal options
 */
export interface AncestryOptions {
  /** Maximum number of commits to traverse */
  limit?: number;
  /** Stop at these commit IDs (exclusive) */
  stopAt?: ObjectId[];
  /** Only follow first parent (for linear history) */
  firstParentOnly?: boolean;
}

/**
 * Commit storage interface
 *
 * Manages commit objects with graph traversal capabilities.
 * Commits are stored as Git-compatible commit objects.
 *
 * Implementation notes (JGit patterns):
 * - Commits are text-based with header fields followed by blank line and message
 * - Format: "tree <hex>\nparent <hex>\nauthor <ident>\ncommitter <ident>\n\n<message>"
 * - Parents are listed in order (first parent is the "main" branch in merges)
 * - PersonIdent format: "Name <email> timestamp timezone"
 */
export interface CommitStorage {
  /**
   * Store a commit object
   *
   * @param commit Commit data
   * @returns ObjectId of the stored commit
   */
  storeCommit(commit: Commit): Promise<ObjectId>;

  /**
   * Load a commit object by ID
   *
   * @param id ObjectId of the commit
   * @returns Parsed commit object
   * @throws Error if commit not found or invalid format
   */
  loadCommit(id: ObjectId): Promise<Commit>;

  /**
   * Get parent commit IDs
   *
   * @param id ObjectId of the commit
   * @returns Array of parent ObjectIds
   */
  getParents(id: ObjectId): Promise<ObjectId[]>;

  /**
   * Get the tree ObjectId for a commit
   *
   * @param id ObjectId of the commit
   * @returns ObjectId of the root tree
   */
  getTree(id: ObjectId): Promise<ObjectId>;

  /**
   * Walk commit ancestry (depth-first)
   *
   * Traverses the commit graph from the starting commit(s),
   * yielding commits in reverse chronological order.
   *
   * @param startIds Starting commit ObjectId(s)
   * @param options Traversal options
   * @returns AsyncIterable of commit ObjectIds
   */
  walkAncestry(
    startIds: ObjectId | ObjectId[],
    options?: AncestryOptions,
  ): AsyncIterable<ObjectId>;

  /**
   * Find merge base (common ancestor)
   *
   * Finds the best common ancestor(s) for merge operations.
   *
   * @param commitA First commit ObjectId
   * @param commitB Second commit ObjectId
   * @returns ObjectId(s) of merge base commit(s)
   */
  findMergeBase(commitA: ObjectId, commitB: ObjectId): Promise<ObjectId[]>;

  /**
   * Check if commit exists
   *
   * @param id ObjectId of the commit
   * @returns True if commit exists
   */
  hasCommit(id: ObjectId): Promise<boolean>;

  /**
   * Check if commitA is ancestor of commitB
   *
   * @param ancestorId Potential ancestor commit
   * @param descendantId Potential descendant commit
   * @returns True if ancestorId is an ancestor of descendantId
   */
  isAncestor(ancestorId: ObjectId, descendantId: ObjectId): Promise<boolean>;
}
