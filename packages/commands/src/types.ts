import type {
  // Legacy interfaces - used by commands internally during migration
  BlobStore,
  Checkout,
  CheckoutStore,
  CommitStore,
  FilesApi,
  History,
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
 * @deprecated Use {@link WorkingCopy} from `@statewalker/vcs-core` instead.
 *
 * Migration example:
 * ```typescript
 * // Before:
 * const store: GitStore = { blobs, trees, commits, refs, staging };
 * const git = Git.wrap(store);
 *
 * // After:
 * const workingCopy = await createWorkingCopy({ files, workDir });
 * const git = Git.fromWorkingCopy(workingCopy);
 *
 * // Access stores via:
 * // - workingCopy.history.blobs (instead of store.blobs)
 * // - workingCopy.checkout.staging (instead of store.staging)
 * ```
 *
 * This interface will be removed in a future version.
 *
 * @see WorkingCopy for the new unified interface
 */
export interface GitStore {
  /** Optional: Full history facade (new architecture) */
  readonly history?: History;

  /** Optional: Full checkout facade (new architecture) */
  readonly checkout?: Checkout;

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
 * @deprecated Use {@link WorkingCopy} from `@statewalker/vcs-core` instead.
 *
 * Migration example:
 * ```typescript
 * // Before:
 * const store: GitStoreWithWorkTree = { ...baseStore, worktree };
 * const git = Git.wrap(store);
 *
 * // After:
 * const workingCopy = await createWorkingCopy({ files, workDir });
 * const git = Git.fromWorkingCopy(workingCopy);
 *
 * // Access worktree via workingCopy.worktreeInterface
 * ```
 *
 * This interface will be removed in a future version.
 *
 * @see WorkingCopy for the new unified interface
 */
export interface GitStoreWithWorkTree extends GitStore {
  /** Working tree interface for filesystem operations */
  readonly worktree: WorktreeStore;
}

/**
 * Extended GitStore interface with file system write support.
 *
 * @deprecated Use {@link WorkingCopy} from `@statewalker/vcs-core` instead.
 *
 * Migration example:
 * ```typescript
 * // Before:
 * const store: GitStoreWithFiles = { ...baseStore, worktree, files, workTreeRoot };
 * const git = Git.wrap(store);
 *
 * // After:
 * const workingCopy = await createWorkingCopy({ files, workDir });
 * const git = Git.fromWorkingCopy(workingCopy);
 *
 * // File operations are handled automatically via workingCopy.worktreeInterface
 * ```
 *
 * This interface will be removed in a future version.
 *
 * @see WorkingCopy for the new unified interface
 */
export interface GitStoreWithFiles extends GitStoreWithWorkTree {
  /** FilesApi for writing files to the working tree */
  readonly files: FilesApi;
  /** Root path of the working tree (relative or absolute) */
  readonly workTreeRoot: string;
}

/**
 * Options for creating a GitStore from a HistoryStore.
 *
 * @deprecated Use {@link WorkingCopy} from `@statewalker/vcs-core` instead.
 * This interface will be removed in a future version.
 */
export interface CreateGitStoreOptions {
  /** The History facade providing object stores (accepts both History and HistoryStore) */
  repository: History | HistoryStore;

  /** Staging area for index operations */
  staging: StagingStore;

  /** Optional working tree interface for filesystem operations */
  worktree?: WorktreeStore;

  /** Optional FilesApi for writing files to the working tree */
  files?: FilesApi;

  /** Optional root path of the working tree (required if files is provided) */
  workTreeRoot?: string;
}

/**
 * Create a GitStore from a HistoryStore and staging store.
 *
 * @deprecated Use {@link WorkingCopy} and {@link Git.fromWorkingCopy} instead.
 *
 * Migration example:
 * ```typescript
 * // Before:
 * const store = createGitStore({ repository, staging, worktree });
 * const git = Git.wrap(store);
 *
 * // After:
 * const workingCopy = await createWorkingCopy({ files, workDir });
 * const git = Git.fromWorkingCopy(workingCopy);
 * ```
 *
 * This function will be removed in a future version.
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

  // Both HistoryStore and History have compatible blobs, trees, commits, refs, tags
  // Note: Using 'as unknown as' because new interfaces (Blobs, Trees, etc.) have
  // slightly different method signatures. These deprecated functions will be removed.
  const store: GitStore = {
    blobs: repository.blobs as unknown as BlobStore,
    trees: repository.trees as unknown as TreeStore,
    commits: repository.commits as unknown as CommitStore,
    refs: repository.refs as unknown as RefStore,
    staging: staging,
    tags: repository.tags as unknown as TagStore | undefined,
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
 * @deprecated Use {@link Git.fromWorkingCopy} directly instead.
 *
 * Migration example:
 * ```typescript
 * // Before:
 * const store = createGitStoreFromWorkingCopy(workingCopy);
 * const git = Git.wrap(store);
 *
 * // After:
 * const git = Git.fromWorkingCopy(workingCopy);
 * ```
 *
 * This function will be removed in a future version.
 *
 * @param workingCopy The WorkingCopy to create the store from
 * @returns GitStoreWithWorkTree for use with Git commands
 */
export function createGitStoreFromWorkingCopy(workingCopy: WorkingCopy): GitStoreWithWorkTree {
  const { repository, staging, worktree, history, checkout } = workingCopy;

  // Use legacy store interfaces from repository (History/HistoryStore both provide compatible stores)
  // Note: Using 'as unknown as' because new interfaces have slightly different method signatures.
  const blobs = (history?.blobs ?? repository.blobs) as unknown as BlobStore;
  const trees = (history?.trees ?? repository.trees) as unknown as TreeStore;
  const commits = (history?.commits ?? repository.commits) as unknown as CommitStore;
  const refs = (history?.refs ?? repository.refs) as unknown as RefStore;
  const tags = (history?.tags ?? repository.tags) as unknown as TagStore | undefined;
  const effectiveStaging = (checkout?.staging ?? staging) as unknown as StagingStore;

  return {
    history,
    checkout,
    blobs,
    trees,
    commits,
    refs,
    staging: effectiveStaging,
    tags,
    worktree: worktree as WorktreeStore,
  };
}

// ============ Three-Part Store Architecture ============

/**
 * Three-part store configuration for Git operations.
 *
 * @deprecated Use {@link WorkingCopy} from `@statewalker/vcs-core` instead.
 *
 * The three-part architecture (History, Checkout, Worktree) is now
 * encapsulated within WorkingCopy. Use WorkingCopy directly:
 * ```typescript
 * const workingCopy = await createWorkingCopy({ files, workDir });
 * const git = Git.fromWorkingCopy(workingCopy);
 *
 * // Access components via:
 * // - workingCopy.history
 * // - workingCopy.checkout
 * // - workingCopy.worktreeInterface
 * ```
 *
 * This interface will be removed in a future version.
 */
export interface GitStoresConfig {
  /** Immutable history storage (Part 1) - History facade */
  readonly history: History;

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
 * @deprecated Use {@link Git.fromWorkingCopy} with a {@link WorkingCopy} instead.
 *
 * Migration example:
 * ```typescript
 * // Before:
 * const store = createGitStoreFromStores({ history, checkout, worktree });
 * const git = Git.wrap(store);
 *
 * // After:
 * const workingCopy = await createWorkingCopy({ files, workDir });
 * const git = Git.fromWorkingCopy(workingCopy);
 * ```
 *
 * This function will be removed in a future version.
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

  // Check if history is a History facade (new architecture)
  const historyFacade =
    "blobs" in history && "initialize" in history ? (history as History) : undefined;

  // Note: Using 'as unknown as' because new interfaces have slightly different method signatures.
  const store: GitStore = {
    history: historyFacade,
    checkout: checkout as Checkout | undefined,
    blobs: history.blobs as unknown as BlobStore,
    trees: history.trees as unknown as TreeStore,
    commits: history.commits as unknown as CommitStore,
    refs: history.refs as unknown as RefStore,
    staging: effectiveStaging as unknown as StagingStore,
    tags: history.tags as unknown as TagStore | undefined,
  };

  if (worktree) {
    return { ...store, worktree } as GitStoreWithWorkTree;
  }

  return store;
}

// ============ New Architecture Re-exports ============

/**
 * Re-export WorkingCopy and related types from core for convenience.
 *
 * These are the preferred types for new code. Use them instead of
 * the deprecated GitStore, GitStoreWithWorkTree, GitStoreWithFiles.
 *
 * @example
 * ```typescript
 * import { WorkingCopy, History, Checkout, Worktree, Blobs, Trees, Commits } from "@statewalker/vcs-commands";
 *
 * // Or import directly from core:
 * import { WorkingCopy } from "@statewalker/vcs-core";
 * ```
 */
export type {
  /** Blobs interface - file content storage */
  Blobs,
  /** Checkout interface - mutable local state */
  Checkout,
  /** Commits interface - commit object storage */
  Commits,
  /** History interface - immutable repository objects */
  History,
  /** Refs interface - branch and tag references */
  Refs,
  /** Staging interface - index/staging area */
  Staging,
  /** Tags interface - annotated tag storage */
  Tags,
  /** Trees interface - directory structure storage */
  Trees,
  /** WorkingCopy interface - unified repository access */
  WorkingCopy,
  /** Worktree interface - filesystem access */
  Worktree,
} from "@statewalker/vcs-core";
