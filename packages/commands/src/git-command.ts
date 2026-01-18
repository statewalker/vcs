import type { ObjectId, Ref, SymbolicRef } from "@statewalker/vcs-core";
import { isSymbolicRef } from "@statewalker/vcs-core";

import { NoHeadError, RefNotFoundError } from "./errors/index.js";
import type { GitStore } from "./types.js";

/**
 * Abstract base class for all Git commands.
 *
 * Implements the Command pattern with single-use semantics.
 * Each command instance can only be called once.
 *
 * Based on JGit's GitCommand<T> class.
 *
 * @typeParam T - The return type of the command's call() method
 */
export abstract class GitCommand<T> {
  protected readonly store: GitStore;
  private callable = true;

  constructor(store: GitStore) {
    this.store = store;
  }

  /**
   * Execute the command.
   * Can only be called once per instance.
   */
  abstract call(): Promise<T>;

  /**
   * Get the store this command operates on.
   */
  getStore(): GitStore {
    return this.store;
  }

  /**
   * Verify the command hasn't been called yet.
   * @throws Error if command was already executed
   */
  protected checkCallable(): void {
    if (!this.callable) {
      throw new Error(`Command ${this.constructor.name} has already been called`);
    }
  }

  /**
   * Mark command as no longer callable.
   */
  protected setCallable(value: boolean): void {
    this.callable = value;
  }

  /**
   * Resolve HEAD to its target commit.
   *
   * @returns ObjectId of the commit HEAD points to
   * @throws NoHeadError if HEAD doesn't exist or cannot be resolved
   */
  protected async resolveHead(): Promise<ObjectId> {
    const ref = await this.store.refs.resolve("HEAD");
    if (!ref?.objectId) {
      throw new NoHeadError("HEAD cannot be resolved");
    }
    return ref.objectId;
  }

  /**
   * Get the current branch name (if HEAD is not detached).
   *
   * @returns Branch name (e.g., "refs/heads/main") or undefined if detached
   */
  protected async getCurrentBranch(): Promise<string | undefined> {
    const head = await this.store.refs.get("HEAD");
    if (head && isSymbolicRef(head)) {
      return head.target;
    }
    return undefined;
  }

  /**
   * Resolve a ref name to its ObjectId.
   *
   * @param refName Ref name, commit ID, or commit-ish
   * @returns ObjectId of the resolved ref
   * @throws RefNotFoundError if ref cannot be resolved
   */
  protected async resolveRef(refName: string): Promise<ObjectId> {
    // Handle relative refs like HEAD~1, HEAD^
    if (refName.includes("~") || refName.includes("^")) {
      return this.resolveRelativeRef(refName);
    }

    // Try as direct ref first
    const ref = await this.store.refs.resolve(refName);
    if (ref?.objectId) {
      // Peel tag objects to commits
      return this.peelToCommit(ref.objectId);
    }

    // Try as branch name
    const branchRef = await this.store.refs.resolve(`refs/heads/${refName}`);
    if (branchRef?.objectId) {
      return branchRef.objectId;
    }

    // Try as tag name
    const tagRef = await this.store.refs.resolve(`refs/tags/${refName}`);
    if (tagRef?.objectId) {
      // Peel tag objects to commits
      return this.peelToCommit(tagRef.objectId);
    }

    // Try as direct commit ID
    if (await this.store.commits.hasCommit(refName)) {
      return refName;
    }

    throw new RefNotFoundError(refName);
  }

  /**
   * Resolve a relative ref like HEAD~1 or HEAD^2.
   */
  private async resolveRelativeRef(ref: string): Promise<ObjectId> {
    // Parse the ref
    const match = ref.match(/^([^~^]+)((?:[~^]\d*)+)$/);
    if (!match) {
      throw new RefNotFoundError(ref);
    }

    const baseRef = match[1];
    const modifiers = match[2];

    let commitId = await this.resolveRef(baseRef);

    // Process each modifier
    const modifierMatch = modifiers.matchAll(/([~^])(\d*)/g);
    for (const m of modifierMatch) {
      const type = m[1];
      const count = m[2] ? parseInt(m[2], 10) : 1;

      if (type === "~") {
        // ~N means follow first parent N times
        for (let i = 0; i < count; i++) {
          const commit = await this.store.commits.loadCommit(commitId);
          if (commit.parents.length === 0) {
            throw new RefNotFoundError(ref, `Cannot resolve ${ref}: no parent`);
          }
          commitId = commit.parents[0];
        }
      } else if (type === "^") {
        // ^N means follow Nth parent
        const commit = await this.store.commits.loadCommit(commitId);
        const parentIndex = count > 0 ? count - 1 : 0;
        if (commit.parents.length <= parentIndex) {
          throw new RefNotFoundError(ref, `Cannot resolve ${ref}: no parent ${count}`);
        }
        commitId = commit.parents[parentIndex];
      }
    }

    return commitId;
  }

  /**
   * Peel an object ID to a commit (follows tag objects).
   */
  private async peelToCommit(objectId: ObjectId): Promise<ObjectId> {
    // If it's already a commit, return it
    if (await this.store.commits.hasCommit(objectId)) {
      return objectId;
    }

    // Try to load as tag and get target
    if (this.store.tags) {
      try {
        const tag = await this.store.tags.loadTag(objectId);
        // Recursively peel
        return this.peelToCommit(tag.object);
      } catch {
        // Not a tag
      }
    }

    // Return as-is (might be a tree or blob in some contexts)
    return objectId;
  }

  /**
   * Get a ref by name.
   *
   * @param refName Full ref name
   * @returns Ref object or undefined
   */
  protected async getRef(refName: string): Promise<Ref | SymbolicRef | undefined> {
    return this.store.refs.get(refName);
  }
}
