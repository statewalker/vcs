import {
  AddCommand,
  CheckoutCommand,
  CherryPickCommand,
  CloneCommand,
  CommitCommand,
  CreateBranchCommand,
  DeleteBranchCommand,
  DeleteTagCommand,
  DescribeCommand,
  DiffCommand,
  FetchCommand,
  ListBranchCommand,
  ListTagCommand,
  LogCommand,
  LsRemoteCommand,
  MergeCommand,
  PullCommand,
  PushCommand,
  RebaseCommand,
  RemoteAddCommand,
  RemoteListCommand,
  RemoteRemoveCommand,
  RemoteSetUrlCommand,
  RenameBranchCommand,
  ResetCommand,
  RevertCommand,
  StashApplyCommand,
  StashCreateCommand,
  StashDropCommand,
  StashListCommand,
  StatusCommand,
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

  // ============ Add Operations ============

  /**
   * Create an AddCommand for staging files from working tree.
   *
   * Requires a GitStoreWithWorkTree (store with worktree iterator).
   *
   * @example
   * ```typescript
   * // Add specific files
   * await git.add()
   *   .addFilepattern("src/")
   *   .addFilepattern("lib/")
   *   .call();
   *
   * // Update only tracked files (git add -u)
   * await git.add()
   *   .addFilepattern(".")
   *   .setUpdate(true)
   *   .call();
   * ```
   */
  add(): AddCommand {
    this.checkClosed();
    return new AddCommand(this.store);
  }

  // ============ Checkout Operations ============

  /**
   * Create a CheckoutCommand for switching branches or restoring files.
   *
   * @example
   * ```typescript
   * // Checkout existing branch
   * await git.checkout().setName("feature").call();
   *
   * // Create and checkout new branch
   * await git.checkout()
   *   .setCreateBranch(true)
   *   .setName("newbranch")
   *   .call();
   *
   * // Checkout paths from commit
   * await git.checkout()
   *   .setStartPoint("HEAD~1")
   *   .addPath("file.txt")
   *   .call();
   * ```
   */
  checkout(): CheckoutCommand {
    this.checkClosed();
    return new CheckoutCommand(this.store);
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

  // ============ Cherry-pick Operations ============

  /**
   * Create a CherryPickCommand for cherry-picking commits.
   *
   * @example
   * ```typescript
   * await git.cherryPick().include(commitId).call();
   * ```
   */
  cherryPick(): CherryPickCommand {
    this.checkClosed();
    return new CherryPickCommand(this.store);
  }

  // ============ Revert Operations ============

  /**
   * Create a RevertCommand for reverting commits.
   *
   * @example
   * ```typescript
   * await git.revert().include(commitId).call();
   * ```
   */
  revert(): RevertCommand {
    this.checkClosed();
    return new RevertCommand(this.store);
  }

  // ============ Describe Operations ============

  /**
   * Create a DescribeCommand for describing commits with tags.
   *
   * @example
   * ```typescript
   * // Describe HEAD
   * const result = await git.describe().call();
   * console.log(result.description); // e.g., "v1.0.0-5-gabcdef0"
   *
   * // Describe with all tags including lightweight
   * const result = await git.describe().setTags(true).call();
   *
   * // Always output something
   * const result = await git.describe().setAlways(true).call();
   * ```
   */
  describe(): DescribeCommand {
    this.checkClosed();
    return new DescribeCommand(this.store);
  }

  // ============ Status Operations ============

  /**
   * Create a StatusCommand for showing staging area status.
   *
   * @example
   * ```typescript
   * const status = await git.status().call();
   * if (status.isClean()) {
   *   console.log("Nothing to commit");
   * }
   * ```
   */
  status(): StatusCommand {
    this.checkClosed();
    return new StatusCommand(this.store);
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

  // ============ Remote Operations ============

  /**
   * Create a FetchCommand for fetching from remotes.
   *
   * @example
   * ```typescript
   * await git.fetch()
   *   .setRemote("origin")
   *   .call();
   * ```
   */
  fetch(): FetchCommand {
    this.checkClosed();
    return new FetchCommand(this.store);
  }

  /**
   * Create a PushCommand for pushing to remotes.
   *
   * @example
   * ```typescript
   * await git.push()
   *   .setRemote("origin")
   *   .call();
   * ```
   */
  push(): PushCommand {
    this.checkClosed();
    return new PushCommand(this.store);
  }

  /**
   * Create a PullCommand for pulling from remotes.
   *
   * @example
   * ```typescript
   * await git.pull()
   *   .setRemote("origin")
   *   .call();
   * ```
   */
  pull(): PullCommand {
    this.checkClosed();
    return new PullCommand(this.store);
  }

  /**
   * Create a CloneCommand for cloning repositories.
   *
   * @example
   * ```typescript
   * await git.clone()
   *   .setURI("https://github.com/user/repo")
   *   .call();
   * ```
   */
  clone(): CloneCommand {
    this.checkClosed();
    return new CloneCommand(this.store);
  }

  /**
   * Create an LsRemoteCommand for listing remote refs.
   *
   * @example
   * ```typescript
   * const refs = await git.lsRemote()
   *   .setRemote("https://github.com/user/repo")
   *   .call();
   * ```
   */
  lsRemote(): LsRemoteCommand {
    this.checkClosed();
    return new LsRemoteCommand(this.store);
  }

  // ============ Remote Configuration Operations ============

  /**
   * Create a RemoteAddCommand for adding remotes.
   *
   * @example
   * ```typescript
   * await git.remoteAdd()
   *   .setName("upstream")
   *   .setUri("https://github.com/user/repo")
   *   .call();
   * ```
   */
  remoteAdd(): RemoteAddCommand {
    this.checkClosed();
    return new RemoteAddCommand(this.store);
  }

  /**
   * Create a RemoteRemoveCommand for removing remotes.
   *
   * @example
   * ```typescript
   * await git.remoteRemove()
   *   .setRemoteName("upstream")
   *   .call();
   * ```
   */
  remoteRemove(): RemoteRemoveCommand {
    this.checkClosed();
    return new RemoteRemoveCommand(this.store);
  }

  /**
   * Create a RemoteListCommand for listing remotes.
   *
   * @example
   * ```typescript
   * const remotes = await git.remoteList().call();
   * ```
   */
  remoteList(): RemoteListCommand {
    this.checkClosed();
    return new RemoteListCommand(this.store);
  }

  /**
   * Create a RemoteSetUrlCommand for changing remote URLs.
   *
   * @example
   * ```typescript
   * await git.remoteSetUrl()
   *   .setRemoteName("origin")
   *   .setRemoteUri("https://github.com/user/repo")
   *   .call();
   * ```
   */
  remoteSetUrl(): RemoteSetUrlCommand {
    this.checkClosed();
    return new RemoteSetUrlCommand(this.store);
  }

  // ============ Rebase Operations ============

  /**
   * Create a RebaseCommand for rebasing commits.
   *
   * @example
   * ```typescript
   * // Rebase current branch onto main
   * const result = await git.rebase()
   *   .setUpstream(mainCommitId)
   *   .call();
   *
   * // Abort rebase in progress
   * const result = await git.rebase()
   *   .setOperation(RebaseOperation.ABORT)
   *   .call();
   * ```
   */
  rebase(): RebaseCommand {
    this.checkClosed();
    return new RebaseCommand(this.store);
  }

  // ============ Stash Operations ============

  /**
   * Create a StashCreateCommand for stashing changes.
   *
   * @example
   * ```typescript
   * const stashCommit = await git.stashCreate()
   *   .setWorkingTreeProvider(provider)
   *   .setMessage("WIP: feature work")
   *   .call();
   * ```
   */
  stashCreate(): StashCreateCommand {
    this.checkClosed();
    return new StashCreateCommand(this.store);
  }

  /**
   * Create a StashApplyCommand for applying stashed changes.
   *
   * @example
   * ```typescript
   * // Apply most recent stash
   * const result = await git.stashApply().call();
   *
   * // Apply specific stash
   * const result = await git.stashApply()
   *   .setStashRef("stash@{2}")
   *   .call();
   * ```
   */
  stashApply(): StashApplyCommand {
    this.checkClosed();
    return new StashApplyCommand(this.store);
  }

  /**
   * Create a StashDropCommand for dropping stashes.
   *
   * @example
   * ```typescript
   * // Drop most recent stash
   * await git.stashDrop().call();
   *
   * // Drop all stashes
   * await git.stashDrop().setAll(true).call();
   * ```
   */
  stashDrop(): StashDropCommand {
    this.checkClosed();
    return new StashDropCommand(this.store);
  }

  /**
   * Create a StashListCommand for listing stashes.
   *
   * @example
   * ```typescript
   * const stashes = await git.stashList().call();
   * for (const stash of stashes) {
   *   console.log(`stash@{${stash.index}}: ${stash.message}`);
   * }
   * ```
   */
  stashList(): StashListCommand {
    this.checkClosed();
    return new StashListCommand(this.store);
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
