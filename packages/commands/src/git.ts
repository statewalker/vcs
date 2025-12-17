import {
  CommitCommand,
  CreateBranchCommand,
  DeleteBranchCommand,
  DeleteTagCommand,
  DiffCommand,
  ListBranchCommand,
  ListTagCommand,
  LogCommand,
  MergeCommand,
  RenameBranchCommand,
  ResetCommand,
  TagCommand,
} from "./commands/index.js";
import type { GitStore } from "./types.js";

/**
 * Main entry point for high-level Git operations.
 *
 * Wraps a GitStore and provides factory methods for all commands.
 * Based on JGit's Git class.
 *
 * @example
 * ```typescript
 * // Create and open store
 * const store = new FilesGitStore(files, "/repo");
 * await store.open();
 *
 * // Create Git facade
 * const git = Git.wrap(store);
 *
 * // Use commands
 * await git.commit().setMessage("Initial commit").call();
 * const branches = await git.branchList().call();
 * for await (const commit of await git.log().call()) {
 *   console.log(commit.message);
 * }
 *
 * // Clean up
 * git.close();
 * ```
 */
export class Git implements Disposable {
  private readonly store: GitStore;
  private closed = false;

  private constructor(store: GitStore) {
    this.store = store;
  }

  // ============ Static Factory Methods ============

  /**
   * Wrap an already-opened GitStore.
   *
   * The caller is responsible for closing the store; close() on this
   * instance does not close the underlying store.
   *
   * @param store The GitStore to wrap
   * @returns A Git instance wrapping the store
   */
  static wrap(store: GitStore): Git {
    return new Git(store);
  }

  /**
   * Open a Git facade for an already-opened GitStore.
   *
   * Alias for wrap() for compatibility with JGit patterns.
   *
   * @param store The GitStore to wrap
   * @returns A Git instance wrapping the store
   */
  static open(store: GitStore): Git {
    return new Git(store);
  }

  // ============ Commit Operations ============

  /**
   * Create a CommitCommand for creating commits.
   *
   * @example
   * ```typescript
   * await git.commit()
   *   .setMessage("Add feature")
   *   .setAuthor("John", "john@example.com")
   *   .call();
   * ```
   */
  commit(): CommitCommand {
    this.checkClosed();
    return new CommitCommand(this.store);
  }

  // ============ Log Operations ============

  /**
   * Create a LogCommand for viewing commit history.
   *
   * @example
   * ```typescript
   * for await (const commit of await git.log().call()) {
   *   console.log(commit.message);
   * }
   * ```
   */
  log(): LogCommand {
    this.checkClosed();
    return new LogCommand(this.store);
  }

  // ============ Branch Operations ============

  /**
   * Create a CreateBranchCommand for creating branches.
   *
   * @example
   * ```typescript
   * await git.branchCreate().setName("feature").call();
   * ```
   */
  branchCreate(): CreateBranchCommand {
    this.checkClosed();
    return new CreateBranchCommand(this.store);
  }

  /**
   * Create a DeleteBranchCommand for deleting branches.
   *
   * @example
   * ```typescript
   * await git.branchDelete().setBranchNames("feature").call();
   * ```
   */
  branchDelete(): DeleteBranchCommand {
    this.checkClosed();
    return new DeleteBranchCommand(this.store);
  }

  /**
   * Create a ListBranchCommand for listing branches.
   *
   * @example
   * ```typescript
   * const branches = await git.branchList().call();
   * ```
   */
  branchList(): ListBranchCommand {
    this.checkClosed();
    return new ListBranchCommand(this.store);
  }

  /**
   * Create a RenameBranchCommand for renaming branches.
   *
   * @example
   * ```typescript
   * await git.branchRename()
   *   .setOldName("old")
   *   .setNewName("new")
   *   .call();
   * ```
   */
  branchRename(): RenameBranchCommand {
    this.checkClosed();
    return new RenameBranchCommand(this.store);
  }

  // ============ Tag Operations ============

  /**
   * Create a TagCommand for creating tags.
   *
   * @example
   * ```typescript
   * await git.tag().setName("v1.0.0").call();
   * ```
   */
  tag(): TagCommand {
    this.checkClosed();
    return new TagCommand(this.store);
  }

  /**
   * Create a DeleteTagCommand for deleting tags.
   *
   * @example
   * ```typescript
   * await git.tagDelete().setTags("v1.0.0").call();
   * ```
   */
  tagDelete(): DeleteTagCommand {
    this.checkClosed();
    return new DeleteTagCommand(this.store);
  }

  /**
   * Create a ListTagCommand for listing tags.
   *
   * @example
   * ```typescript
   * const tags = await git.tagList().call();
   * ```
   */
  tagList(): ListTagCommand {
    this.checkClosed();
    return new ListTagCommand(this.store);
  }

  // ============ Reset Operations ============

  /**
   * Create a ResetCommand for resetting HEAD.
   *
   * @example
   * ```typescript
   * await git.reset().setRef("HEAD~1").call();
   * ```
   */
  reset(): ResetCommand {
    this.checkClosed();
    return new ResetCommand(this.store);
  }

  // ============ Merge Operations ============

  /**
   * Create a MergeCommand for merging branches.
   *
   * @example
   * ```typescript
   * await git.merge().include("feature").call();
   * ```
   */
  merge(): MergeCommand {
    this.checkClosed();
    return new MergeCommand(this.store);
  }

  // ============ Diff Operations ============

  /**
   * Create a DiffCommand for comparing trees/commits.
   *
   * @example
   * ```typescript
   * const entries = await git.diff()
   *   .setOldTree("main")
   *   .setNewTree("feature")
   *   .call();
   * ```
   */
  diff(): DiffCommand {
    this.checkClosed();
    return new DiffCommand(this.store);
  }

  // ============ Lifecycle ============

  /**
   * Get the underlying store.
   */
  getStore(): GitStore {
    return this.store;
  }

  /**
   * Close the Git instance.
   *
   * After calling this method, no more commands can be created.
   * This does NOT close the underlying store.
   */
  close(): void {
    this.closed = true;
  }

  /**
   * Disposable interface implementation.
   */
  [Symbol.dispose](): void {
    this.close();
  }

  // ============ Private ============

  private checkClosed(): void {
    if (this.closed) {
      throw new Error("Git instance is closed");
    }
  }
}
