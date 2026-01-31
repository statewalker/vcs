import type { Checkout, History, WorkingCopy, Worktree } from "@statewalker/vcs-core";

import {
  AddCommand,
  BlameCommand,
  CheckoutCommand,
  CherryPickCommand,
  CleanCommand,
  CloneCommand,
  CommitCommand,
  CreateBranchCommand,
  DeleteBranchCommand,
  DeleteTagCommand,
  DescribeCommand,
  DiffCommand,
  FetchCommand,
  GarbageCollectCommand,
  InitCommand,
  ListBranchCommand,
  ListTagCommand,
  LogCommand,
  LsRemoteCommand,
  MergeCommand,
  PackRefsCommand,
  PullCommand,
  PushCommand,
  RebaseCommand,
  ReflogCommand,
  RemoteAddCommand,
  RemoteListCommand,
  RemoteRemoveCommand,
  RemoteSetUrlCommand,
  RenameBranchCommand,
  ResetCommand,
  RevertCommand,
  RmCommand,
  StashApplyCommand,
  StashCreateCommand,
  StashDropCommand,
  StashListCommand,
  StatusCommand,
  TagCommand,
} from "./commands/index.js";
import type { CreateGitStoreOptions, GitStore, GitStoresConfig } from "./types.js";
import {
  createGitStore,
  createGitStoreFromStores,
  createGitStoreFromWorkingCopy,
} from "./types.js";

/**
 * Main entry point for high-level Git operations.
 *
 * The Git class is a facade that wraps a WorkingCopy and provides
 * factory methods for all Git commands.
 *
 * Based on JGit's Git class.
 *
 * @example Using with WorkingCopy (recommended)
 * ```typescript
 * // Create a WorkingCopy
 * const workingCopy = await createWorkingCopy({ files, workDir: "/repo" });
 *
 * // Create Git facade
 * const git = Git.fromWorkingCopy(workingCopy);
 *
 * // Use commands
 * await git.commit().setMessage("Initial commit").call();
 * const branches = await git.branchList().call();
 *
 * // Access components for advanced usage
 * const history = git.history;
 * const checkout = git.checkout;
 *
 * // Clean up
 * git.close();
 * ```
 *
 * @example Using with GitStore (legacy, for backward compatibility)
 * ```typescript
 * const store = createGitStore({ repository: repo, staging });
 * const git = Git.wrap(store);
 * ```
 */
export class Git implements Disposable {
  private readonly store: GitStore;
  private readonly _workingCopy?: WorkingCopy;
  private closed = false;

  private constructor(store: GitStore, workingCopy?: WorkingCopy) {
    this.store = store;
    this._workingCopy = workingCopy;
  }

  // ============ Static Factory Methods ============

  /**
   * Create a Git facade from a WorkingCopy.
   *
   * This is the recommended way to create a Git instance. The WorkingCopy
   * provides access to all components: History, Checkout, and Worktree.
   *
   * @example
   * ```typescript
   * const workingCopy = await createWorkingCopy({ files, workDir: "/repo" });
   * const git = Git.fromWorkingCopy(workingCopy);
   *
   * // Use commands
   * await git.add().addFilepattern(".").call();
   * await git.commit().setMessage("Initial commit").call();
   *
   * // Access components
   * const history = git.history;
   * const checkout = git.checkout;
   * ```
   *
   * @param workingCopy The WorkingCopy to wrap
   * @returns A Git instance wrapping the working copy
   */
  static fromWorkingCopy(workingCopy: WorkingCopy): Git {
    const store = createGitStoreFromWorkingCopy(workingCopy);
    return new Git(store, workingCopy);
  }

  /**
   * Wrap an already-opened GitStore.
   *
   * The caller is responsible for closing the store; close() on this
   * instance does not close the underlying store.
   *
   * @deprecated Use `Git.fromWorkingCopy()` instead. This method will be removed in a future version.
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
   * @deprecated Use `Git.fromWorkingCopy()` instead. This method will be removed in a future version.
   * @param store The GitStore to wrap
   * @returns A Git instance wrapping the store
   */
  static open(store: GitStore): Git {
    return new Git(store);
  }

  /**
   * Create a Git facade from a HistoryStore and staging store.
   *
   * This factory method allows using any HistoryStore implementation
   * (file-based, SQL, memory, etc.) with the Git command facade.
   *
   * @deprecated Use `Git.fromWorkingCopy()` instead. This method will be removed in a future version.
   *
   * @example
   * ```typescript
   * import { Git } from "@statewalker/vcs-commands";
   * import { MemoryStagingStore } from "@statewalker/vcs-store-mem";
   *
   * // Use with any HistoryStore implementation
   * const staging = new MemoryStagingStore();
   * const git = Git.fromRepository({ repository: repo, staging });
   * await git.commit().setMessage("Initial commit").call();
   * ```
   *
   * @param options Repository, staging store, and optional worktree
   * @returns A Git instance wrapping the created store
   */
  static fromRepository(options: CreateGitStoreOptions): Git {
    const store = createGitStore(options);
    return new Git(store);
  }

  /**
   * Create a Git facade from the three-part store architecture.
   *
   * This factory method uses the new store separation:
   * - HistoryStore: Immutable history (commits, trees, blobs, refs, tags)
   * - CheckoutStore: Mutable local state (staging, HEAD, in-progress ops)
   * - WorktreeStore: Filesystem access (working tree files)
   *
   * @deprecated Use `Git.fromWorkingCopy()` instead. This method will be removed in a future version.
   *
   * @example
   * ```typescript
   * import { Git } from "@statewalker/vcs-commands";
   *
   * // Use with three-part store architecture
   * const git = Git.fromStores({
   *   history: historyStore,
   *   checkout: checkoutStore,
   *   worktree: worktreeStore,
   * });
   *
   * await git.commit().setMessage("Initial commit").call();
   * ```
   *
   * @example
   * ```typescript
   * // For read-only operations (no checkout store)
   * const git = Git.fromStores({
   *   history: historyStore,
   *   staging: memoryStagingStore,
   * });
   *
   * // Read-only commands work
   * for await (const commit of await git.log().call()) {
   *   console.log(commit.message);
   * }
   * ```
   *
   * @param config Store configuration with history, checkout, and worktree
   * @returns A Git instance for executing commands
   */
  static fromStores(config: GitStoresConfig): Git {
    const store = createGitStoreFromStores(config);
    return new Git(store);
  }

  /**
   * Create an InitCommand for initializing a new Git repository.
   *
   * This static factory method provides convenient access to repository
   * initialization without needing to import InitCommand directly.
   *
   * @example
   * ```typescript
   * // Initialize in-memory repository
   * const result = await Git.init().call();
   * const git = result.git;
   *
   * // Initialize file-based repository with worktree support
   * const result = await Git.init()
   *   .setFilesApi(files)
   *   .setWorktree(true)
   *   .call();
   *
   * // Now git.add() works
   * await result.git.add().addFilepattern(".").call();
   *
   * // Initialize with custom staging for native git compatibility
   * import { FileStagingStore } from "@statewalker/vcs-core";
   * const staging = new FileStagingStore(files, ".git/index");
   *
   * const result = await Git.init()
   *   .setFilesApi(files)
   *   .setStagingStore(staging)
   *   .setWorktree(true)
   *   .call();
   * ```
   *
   * @returns A new InitCommand instance
   */
  static init(): InitCommand {
    return new InitCommand();
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

  // ============ Blame Operations ============

  /**
   * Create a BlameCommand for annotating file lines with authorship.
   *
   * @example
   * ```typescript
   * const result = await git.blame()
   *   .setFilePath("src/main.ts")
   *   .call();
   *
   * for (const entry of result.entries) {
   *   console.log(`${entry.commit.author.name}: lines ${entry.resultStart}-${entry.resultStart + entry.lineCount - 1}`);
   * }
   * ```
   */
  blame(): BlameCommand {
    this.checkClosed();
    return new BlameCommand(this.store);
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

  /**
   * Create a ReflogCommand for viewing reflog entries.
   *
   * @example
   * ```typescript
   * // Get HEAD reflog
   * const entries = await git.reflog().call();
   *
   * // Get reflog for specific branch
   * const branchEntries = await git.reflog()
   *   .setRef("refs/heads/main")
   *   .call();
   * ```
   */
  reflog(): ReflogCommand {
    this.checkClosed();
    return new ReflogCommand(this.store);
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

  // ============ Rm Operations ============

  /**
   * Create an RmCommand for removing files from the index.
   *
   * @example
   * ```typescript
   * // Remove file from index (and working tree if not cached)
   * await git.rm()
   *   .addFilepattern("file.txt")
   *   .call();
   *
   * // Remove from index only (keep in working tree)
   * await git.rm()
   *   .addFilepattern("file.txt")
   *   .setCached(true)
   *   .call();
   * ```
   */
  rm(): RmCommand {
    this.checkClosed();
    return new RmCommand(this.store);
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

  // ============ Maintenance Operations ============

  /**
   * Create a GarbageCollectCommand for repository maintenance.
   *
   * @example
   * ```typescript
   * // Basic garbage collection
   * const result = await git.gc().call();
   *
   * // Aggressive GC with repacking
   * const result = await git.gc()
   *   .setAggressive(true)
   *   .call();
   * ```
   */
  gc(): GarbageCollectCommand {
    this.checkClosed();
    return new GarbageCollectCommand(this.store);
  }

  /**
   * Create a PackRefsCommand for packing loose refs.
   *
   * @example
   * ```typescript
   * // Pack all refs
   * const result = await git.packRefs()
   *   .setAll(true)
   *   .call();
   * ```
   */
  packRefs(): PackRefsCommand {
    this.checkClosed();
    return new PackRefsCommand(this.store);
  }

  /**
   * Create a CleanCommand for removing untracked files.
   *
   * @example
   * ```typescript
   * // Preview what would be cleaned (dry run)
   * const result = await git.clean()
   *   .setDryRun(true)
   *   .call();
   * ```
   */
  clean(): CleanCommand {
    this.checkClosed();
    return new CleanCommand(this.store);
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

  // ============ Component Access ============

  /**
   * Get the underlying WorkingCopy (if available).
   *
   * Returns undefined if the Git instance was created with wrap() or fromRepository().
   * Use fromWorkingCopy() to ensure access to the WorkingCopy.
   *
   * @example
   * ```typescript
   * const git = Git.fromWorkingCopy(workingCopy);
   * const wc = git.workingCopy!;
   *
   * // Access full WorkingCopy API
   * const status = await wc.getStatus();
   * const branch = await wc.getCurrentBranch();
   * ```
   */
  get workingCopy(): WorkingCopy | undefined {
    return this._workingCopy;
  }

  /**
   * Get the History interface for accessing repository objects.
   *
   * Provides access to blobs, trees, commits, tags, and refs.
   * Returns undefined if created with wrap() or if WorkingCopy doesn't have history.
   *
   * @example
   * ```typescript
   * const history = git.history;
   * if (history) {
   *   const commit = await history.commits.load(commitId);
   *   const tree = await history.trees.load(commit.tree);
   * }
   * ```
   */
  get history(): History | undefined {
    return this._workingCopy?.history;
  }

  /**
   * Get the Checkout interface for managing local state.
   *
   * Provides access to staging area, HEAD, and in-progress operations.
   * Returns undefined if created with wrap() or if WorkingCopy doesn't have checkout.
   *
   * Note: Named `checkoutState` to avoid conflict with `checkout()` command method.
   *
   * @example
   * ```typescript
   * const checkoutState = git.checkoutState;
   * if (checkoutState) {
   *   const staging = checkoutState.staging;
   *   const head = await checkoutState.getHeadCommit();
   * }
   * ```
   */
  get checkoutState(): Checkout | undefined {
    return this._workingCopy?.checkout;
  }

  /**
   * Get the Worktree interface for filesystem operations.
   *
   * Provides access to working directory read/write operations.
   * Returns undefined if created with wrap() or if WorkingCopy doesn't have worktree.
   *
   * @example
   * ```typescript
   * const worktree = git.worktree;
   * if (worktree) {
   *   for await (const entry of worktree.walk()) {
   *     console.log(entry.path);
   *   }
   * }
   * ```
   */
  get worktree(): Worktree | undefined {
    return this._workingCopy?.worktreeInterface;
  }

  // ============ Lifecycle ============

  /**
   * Get the underlying store.
   *
   * @deprecated Use component accessors (history, checkout, worktree) instead.
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
