import type { Commit, ObjectId, PersonIdent } from "@webrun-vcs/vcs";
import { isSymbolicRef } from "@webrun-vcs/vcs";

import { EmptyCommitError, NoMessageError, UnmergedPathsError } from "../errors/index.js";
import { GitCommand } from "../git-command.js";
import type { GitStore } from "../types.js";

/**
 * Get current timezone offset as string (+HHMM or -HHMM).
 */
function getTimezoneOffset(): string {
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? "+" : "-";
  const absOffset = Math.abs(offset);
  const hours = Math.floor(absOffset / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (absOffset % 60).toString().padStart(2, "0");
  return `${sign}${hours}${minutes}`;
}

/**
 * Create a commit from staged changes.
 *
 * Equivalent to `git commit`.
 *
 * Based on JGit's CommitCommand.
 *
 * @example
 * ```typescript
 * // Simple commit
 * const commit = await git.commit()
 *   .setMessage("Fix bug in parser")
 *   .call();
 *
 * // Commit with author
 * const commit = await git.commit()
 *   .setMessage("Add feature")
 *   .setAuthor("John Doe", "john@example.com")
 *   .call();
 *
 * // Amend previous commit
 * const commit = await git.commit()
 *   .setMessage("Updated message")
 *   .setAmend(true)
 *   .call();
 *
 * // Allow empty commit
 * const commit = await git.commit()
 *   .setMessage("Empty commit")
 *   .setAllowEmpty(true)
 *   .call();
 * ```
 */
export class CommitCommand extends GitCommand<Commit> {
  private message?: string;
  private author?: PersonIdent;
  private committer?: PersonIdent;
  private amend = false;
  private allowEmpty = false;
  private parents: ObjectId[] = [];

  constructor(store: GitStore) {
    super(store);
  }

  /**
   * Set the commit message.
   *
   * @param message Commit message
   */
  setMessage(message: string): this {
    this.checkCallable();
    this.message = message;
    return this;
  }

  /**
   * Set the author identity.
   *
   * @param name Author name
   * @param email Author email
   */
  setAuthor(name: string, email: string): this {
    this.checkCallable();
    this.author = {
      name,
      email,
      timestamp: Math.floor(Date.now() / 1000),
      tzOffset: getTimezoneOffset(),
    };
    return this;
  }

  /**
   * Set the author identity from a PersonIdent.
   *
   * @param author Author identity
   */
  setAuthorIdent(author: PersonIdent): this {
    this.checkCallable();
    this.author = author;
    return this;
  }

  /**
   * Set the committer identity.
   *
   * @param name Committer name
   * @param email Committer email
   */
  setCommitter(name: string, email: string): this {
    this.checkCallable();
    this.committer = {
      name,
      email,
      timestamp: Math.floor(Date.now() / 1000),
      tzOffset: getTimezoneOffset(),
    };
    return this;
  }

  /**
   * Set the committer identity from a PersonIdent.
   *
   * @param committer Committer identity
   */
  setCommitterIdent(committer: PersonIdent): this {
    this.checkCallable();
    this.committer = committer;
    return this;
  }

  /**
   * Set whether to amend the previous commit.
   *
   * @param amend Whether to amend
   */
  setAmend(amend: boolean): this {
    this.checkCallable();
    this.amend = amend;
    return this;
  }

  /**
   * Set whether to allow an empty commit.
   *
   * @param allowEmpty Whether to allow empty commits
   */
  setAllowEmpty(allowEmpty: boolean): this {
    this.checkCallable();
    this.allowEmpty = allowEmpty;
    return this;
  }

  /**
   * Set explicit parent commits.
   *
   * Normally parents are determined automatically, but this
   * can be used for merge commits or special cases.
   *
   * @param parents Parent commit IDs
   */
  setParentIds(...parents: ObjectId[]): this {
    this.checkCallable();
    this.parents = parents;
    return this;
  }

  /**
   * Execute the commit.
   *
   * @returns The created commit
   * @throws NoMessageError if message is not set and not amending
   * @throws UnmergedPathsError if there are unresolved conflicts
   * @throws EmptyCommitError if nothing to commit and allowEmpty is false
   */
  async call(): Promise<Commit> {
    this.checkCallable();

    // Check message
    if (!this.message && !this.amend) {
      throw new NoMessageError();
    }

    // Check for conflicts
    if (await this.store.staging.hasConflicts()) {
      const conflictPaths: string[] = [];
      for await (const path of this.store.staging.getConflictPaths()) {
        conflictPaths.push(path);
      }
      throw new UnmergedPathsError(conflictPaths);
    }

    // Get message (from amend or new)
    let finalMessage = this.message;
    let previousCommit: Commit | undefined;

    if (this.amend) {
      const headId = await this.resolveHead();
      previousCommit = await this.store.commits.loadCommit(headId);
      if (!finalMessage) {
        finalMessage = previousCommit.message;
      }
    }

    if (!finalMessage) {
      throw new NoMessageError();
    }

    // Determine author and committer
    const defaultIdent: PersonIdent = {
      name: "Unknown",
      email: "unknown@example.com",
      timestamp: Math.floor(Date.now() / 1000),
      tzOffset: getTimezoneOffset(),
    };

    let author = this.author;
    let committer = this.committer;

    if (this.amend && previousCommit) {
      // Keep original author when amending unless explicitly set
      if (!author) {
        author = previousCommit.author;
      }
    }

    if (!author) {
      author = committer ?? defaultIdent;
    }
    if (!committer) {
      committer = author;
    }

    // Generate tree from staging area
    const treeId = await this.store.staging.writeTree(this.store.trees);

    // Determine parents
    let parents: ObjectId[];
    if (this.parents.length > 0) {
      parents = this.parents;
    } else if (this.amend) {
      // Use amended commit's parents
      const headId = await this.resolveHead();
      const headCommit = await this.store.commits.loadCommit(headId);
      parents = headCommit.parents;
    } else {
      // Normal commit - HEAD as parent (if exists)
      try {
        const headId = await this.resolveHead();
        parents = [headId];
      } catch {
        // Initial commit
        parents = [];
      }
    }

    // Check for empty commit
    if (!this.allowEmpty && parents.length > 0) {
      const parentCommit = await this.store.commits.loadCommit(parents[0]);
      if (parentCommit.tree === treeId) {
        throw new EmptyCommitError();
      }
    }

    // Create commit
    const commit: Commit = {
      tree: treeId,
      parents,
      author,
      committer,
      message: finalMessage,
    };

    const commitId = await this.store.commits.storeCommit(commit);

    // Update HEAD/branch ref
    const head = await this.store.refs.get("HEAD");
    if (head && isSymbolicRef(head)) {
      // HEAD points to a branch - update the branch
      await this.store.refs.set(head.target, commitId);
    } else {
      // Detached HEAD - update HEAD directly
      await this.store.refs.set("HEAD", commitId);
    }

    this.setCallable(false);

    return commit;
  }
}
