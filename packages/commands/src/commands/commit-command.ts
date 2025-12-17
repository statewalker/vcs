import type { Commit, ObjectId, PersonIdent } from "@webrun-vcs/vcs";
import { isSymbolicRef } from "@webrun-vcs/vcs";

import { EmptyCommitError, NoMessageError, UnmergedPathsError } from "../errors/index.js";
import { GitCommand } from "../git-command.js";

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
 *
 * // Commit only specific paths
 * const commit = await git.commit()
 *   .setMessage("Partial commit")
 *   .setOnly("src/file.ts", "tests/file.test.ts")
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
  private onlyPaths: string[] = [];

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
   * Set paths to commit (--only mode).
   *
   * When set, only the specified paths are taken from the staging area.
   * All other paths are taken from the parent commit's tree. This allows
   * partial commits without affecting unstaged changes to other files.
   *
   * @param paths Paths to include in commit
   */
  setOnly(...paths: string[]): this {
    this.checkCallable();
    this.onlyPaths = paths;
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

    // Generate tree from staging area
    let treeId: ObjectId;

    if (this.onlyPaths.length > 0 && parents.length > 0) {
      // --only mode: combine parent tree with specified paths from staging
      treeId = await this.buildOnlyTree(parents[0]);
    } else {
      // Normal mode: use full staging area
      treeId = await this.store.staging.writeTree(this.store.trees);
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

  /**
   * Build tree for --only mode.
   *
   * Combines parent tree with specified paths from staging area.
   *
   * @param parentCommitId Parent commit ID
   * @returns Tree ObjectId
   */
  private async buildOnlyTree(parentCommitId: ObjectId): Promise<ObjectId> {
    const parentCommit = await this.store.commits.loadCommit(parentCommitId);

    // Collect staging entries for onlyPaths
    const onlyPathSet = new Set(this.onlyPaths);
    const stagingEntriesMap = new Map<string, { objectId: ObjectId; mode: number }>();

    for await (const entry of this.store.staging.listEntries()) {
      if (onlyPathSet.has(entry.path) && entry.stage === 0) {
        stagingEntriesMap.set(entry.path, {
          objectId: entry.objectId,
          mode: entry.mode,
        });
      }
    }

    // Create builder and populate with filtered tree
    const builder = this.store.staging.builder();

    // Walk parent tree and add entries NOT in onlyPaths
    await this.addTreeFiltered(builder, parentCommit.tree, "", onlyPathSet);

    // Add staging entries for onlyPaths
    for (const [path, { objectId, mode }] of stagingEntriesMap) {
      builder.add({
        path,
        mode,
        objectId,
        size: 0,
        mtime: Date.now(),
      });
    }

    await builder.finish();

    // Now write tree from staging
    return await this.store.staging.writeTree(this.store.trees);
  }

  /**
   * Recursively walk tree and add entries to builder, excluding specified paths.
   */
  private async addTreeFiltered(
    builder: ReturnType<typeof this.store.staging.builder>,
    treeId: ObjectId,
    prefix: string,
    excludePaths: Set<string>,
  ): Promise<void> {
    for await (const entry of this.store.trees.loadTree(treeId)) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;

      // Check if this is a tree (directory)
      const isTree = (entry.mode & 0o170000) === 0o040000;

      if (isTree) {
        // Recursively process subtree
        await this.addTreeFiltered(builder, entry.id, fullPath, excludePaths);
      } else {
        // Only add if not in excluded paths
        if (!excludePaths.has(fullPath)) {
          builder.add({
            path: fullPath,
            mode: entry.mode,
            objectId: entry.id,
            size: 0,
            mtime: Date.now(),
          });
        }
      }
    }
  }
}
