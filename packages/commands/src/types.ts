import type {
  BlobStore,
  CheckoutStore,
  CommitStore,
  FilesApi,
  HistoryStore,
  RefStore,
  StagingStore,
  TagStore,
  TreeStore,
  WorkingCopy,
  WorktreeStore,
} from "@statewalker/vcs-core";

/**
 * Core storage interface for Git operations.
 *
 * GitStore implementations handle persistence and can use various backends:
 * - FilesGitStore: Standard Git-compatible file storage
 * - SqlGitStore: SQL database backend
 * - MemoryGitStore: In-memory (for testing)
 * - CompositeGitStore: Mix of different storage backends
 */
export interface GitStore {
  /** Blob (file content) storage */
  readonly blobs: BlobStore;

  /** File tree (directory) storage */
  readonly trees: TreeStore;

  /** Commit object storage with graph traversal */
  readonly commits: CommitStore;

  /** Branch and tag reference management */
  readonly refs: RefStore;

  /** Staging area (index) management */
  readonly staging: StagingStore;

  /** Tag object storage (optional, for annotated tags) */
  readonly tags?: TagStore;
}

/**
 * Reset mode for ResetCommand.
 *
 * Based on JGit's ResetCommand.ResetType enum.
 */
export enum ResetMode {
  /** Move HEAD only */
  SOFT = "soft",
  /** Move HEAD and reset staging (default) */
  MIXED = "mixed",
  /** Move HEAD, reset staging, and reset working tree */
  HARD = "hard",
  /** Keep local changes if they're not in the way */
  KEEP = "keep",
  /** Like --hard but preserves untracked files */
  MERGE = "merge",
}

/**
 * Branch listing mode for ListBranchCommand.
 *
 * Based on JGit's ListBranchCommand.ListMode enum.
 */
export enum ListBranchMode {
  /** List local branches only (refs/heads/) */
  LOCAL = "local",
  /** List remote tracking branches only (refs/remotes/) */
  REMOTE = "remote",
  /** List both local and remote branches */
  ALL = "all",
}

/**
 * Extended GitStore interface with working tree support.
 *
 * Required for commands that operate on the working tree:
 * - AddCommand: Stage files from working tree
 * - CheckoutCommand: Update working tree from commits
 * - ResetCommand (hard mode): Reset working tree
 * - CleanCommand: Remove untracked files
 *
 * @example
 * ```typescript
 * // Create a store with working tree support
 * const store: GitStoreWithWorkTree = {
 *   ...baseStore,
 *   worktree: createFileTreeIterator(files, workTreeRoot),
 * };
 *
 * // Use with Git facade
 * const git = Git.wrap(store);
 * await git.add().addFilepattern("src/").call();
 * ```
 */
export interface GitStoreWithWorkTree extends GitStore {
  /** Working tree iterator for filesystem operations */
  readonly worktree: WorktreeStore;
}

/**
 * Extended GitStore interface with file system write support.
 *
 * Required for commands that need to write files to the working tree:
 * - CheckoutCommand: Write files from commits to working tree
 * - ResetCommand (hard mode): Reset working tree files
 *
 * If these properties are not provided, the repository is treated as "bare"
 * and working directory updates are skipped.
 *
 * @example
 * ```typescript
 * // Create a store with file write support
 * const store: GitStoreWithFiles = {
 *   ...baseStore,
 *   worktree: createFileTreeIterator(files, ""),
 *   files,
 *   workTreeRoot: "",
 * };
 *
 * // Use with Git facade
 * const git = Git.wrap(store);
 * await git.checkout().setName("feature").call(); // Writes files!
 * ```
 */
export interface GitStoreWithFiles extends GitStoreWithWorkTree {
  /** FilesApi for writing files to the working tree */
  readonly files: FilesApi;
  /** Root path of the working tree (relative or absolute) */
  readonly workTreeRoot: string;
}

/**
 * Options for creating a GitStore from a HistoryStore.
 */
export interface CreateGitStoreOptions {
  /** The history store providing object stores */
  repository: HistoryStore;

  /** Staging area for index operations */
  staging: StagingStore;

  /** Optional working tree iterator for filesystem operations */
  worktree?: WorktreeStore;

  /** Optional FilesApi for writing files to the working tree */
  files?: FilesApi;

  /** Optional root path of the working tree (required if files is provided) */
  workTreeRoot?: string;
}

/**
 * Create a GitStore from a HistoryStore and staging store.
 *
 * This factory function allows using any HistoryStore implementation
 * (file-based, SQL, memory, etc.) with the Git command facade.
 *
 * @example
 * ```typescript
 * import { createGitStore } from "@statewalker/vcs-commands";
 * import { MemoryStagingStore } from "@statewalker/vcs-store-mem";
 *
 * // Use with any Repository implementation
 * const staging = new MemoryStagingStore();
 * const store = createGitStore({ repository: repo, staging });
 * const git = Git.wrap(store);
 *
 * // With file write support for checkout
 * const storeWithFiles = createGitStore({
 *   repository: repo,
 *   staging,
 *   worktree,
 *   files,
 *   workTreeRoot: "",
 * });
 * ```
 *
 * @param options Repository, staging store, and optional worktree/files
 * @returns GitStore, GitStoreWithWorkTree, or GitStoreWithFiles depending on options
 */
export function createGitStore(
  options: CreateGitStoreOptions & {
    worktree: WorktreeStore;
    files: FilesApi;
    workTreeRoot: string;
  },
): GitStoreWithFiles;
export function createGitStore(
  options: CreateGitStoreOptions & { worktree: WorktreeStore },
): GitStoreWithWorkTree;
export function createGitStore(options: CreateGitStoreOptions): GitStore;
export function createGitStore(
  options: CreateGitStoreOptions,
): GitStore | GitStoreWithWorkTree | GitStoreWithFiles {
  const { repository, staging, worktree, files, workTreeRoot } = options;

  const store: GitStore = {
    blobs: repository.blobs,
    trees: repository.trees,
    commits: repository.commits,
    refs: repository.refs,
    staging,
    tags: repository.tags,
  };

  if (worktree && files && workTreeRoot !== undefined) {
    return { ...store, worktree, files, workTreeRoot } as GitStoreWithFiles;
  }

  if (worktree) {
    return { ...store, worktree } as GitStoreWithWorkTree;
  }

  return store;
}

/**
 * Create a GitStoreWithWorkTree from a WorkingCopy.
 *
 * This factory function allows using a WorkingCopy with the Git command facade.
 * The WorkingCopy provides all necessary components: repository, staging, and worktree.
 *
 * @example
 * ```typescript
 * import { createGitStoreFromWorkingCopy } from "@statewalker/vcs-commands";
 *
 * // Use WorkingCopy with Git facade
 * const store = createGitStoreFromWorkingCopy(workingCopy);
 * const git = Git.wrap(store);
 *
 * // Now all commands work with the working copy
 * await git.add().addFilepattern(".").call();
 * await git.status().call();
 * ```
 *
 * @param workingCopy The WorkingCopy to create the store from
 * @returns GitStoreWithWorkTree for use with Git commands
 */
export function createGitStoreFromWorkingCopy(workingCopy: WorkingCopy): GitStoreWithWorkTree {
  const { repository, staging, worktree } = workingCopy;

  return {
    blobs: repository.blobs,
    trees: repository.trees,
    commits: repository.commits,
    refs: repository.refs,
    // Cast needed during migration: WorkingCopy.staging is union type but implementations return StagingStore
    staging: staging as StagingStore,
    tags: repository.tags,
    worktree,
  };
}

// ============ Three-Part Store Architecture ============

/**
 * Three-part store configuration for Git operations.
 *
 * This represents the new architecture where stores are clearly separated:
 * - HistoryStore: Immutable history (commits, trees, blobs, refs, tags)
 * - CheckoutStore: Mutable local state (staging, HEAD, in-progress ops)
 * - WorktreeStore: Filesystem access (working tree files)
 *
 * @example
 * ```typescript
 * const git = Git.fromStores({
 *   history: myHistoryStore,
 *   checkout: myCheckoutStore,
 *   worktree: myWorktreeStore,
 * });
 * ```
 */
export interface GitStoresConfig {
  /** Immutable history storage (Part 1) */
  readonly history: HistoryStore;

  /** Mutable checkout state (Part 3) - optional for read-only operations */
  readonly checkout?: CheckoutStore;

  /** Filesystem access (Part 2) - optional for bare repos */
  readonly worktree?: WorktreeStore;

  /** Staging store - required if checkout not provided */
  readonly staging?: StagingStore;
}

/**
 * Create a GitStore from the three-part store configuration.
 *
 * @param config Store configuration
 * @returns GitStore for use with Git commands
 */
export function createGitStoreFromStores(config: GitStoresConfig): GitStore | GitStoreWithWorkTree {
  const { history, checkout, worktree, staging } = config;

  // Use staging from checkout if available, otherwise from config
  const effectiveStaging = checkout?.staging ?? staging;
  if (!effectiveStaging) {
    throw new Error("Either checkout or staging must be provided");
  }

  const store: GitStore = {
    blobs: history.blobs,
    trees: history.trees,
    commits: history.commits,
    refs: history.refs,
    staging: effectiveStaging,
    tags: history.tags,
  };

  if (worktree) {
    return { ...store, worktree } as GitStoreWithWorkTree;
  }

  return store;
}
