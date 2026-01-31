import type {
  // New interfaces (Phase C) - these are the preferred types
  Blobs,
  Checkout,
  CheckoutStore,
  Commits,
  FilesApi,
  History,
  HistoryStore,
  Refs,
  Staging,
  StagingStore,
  Tags,
  Trees,
  WorkingCopy,
  Worktree,
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
  readonly blobs: Blobs;

  /** File tree (directory) storage */
  readonly trees: Trees;

  /** Commit object storage with graph traversal */
  readonly commits: Commits;

  /** Branch and tag reference management */
  readonly refs: Refs;

  /** Staging area (index) management */
  readonly staging: Staging;

  /** Tag object storage (optional, for annotated tags) */
  readonly tags?: Tags;
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
  readonly worktree: Worktree;
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
  /** The history store providing object stores (legacy) or History facade (new) */
  repository: HistoryStore | History;

  /** Staging area for index operations */
  staging: Staging | StagingStore;

  /** Optional working tree interface for filesystem operations */
  worktree?: Worktree | WorktreeStore;

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
    worktree: Worktree | WorktreeStore;
    files: FilesApi;
    workTreeRoot: string;
  },
): GitStoreWithFiles;
export function createGitStore(
  options: CreateGitStoreOptions & { worktree: Worktree | WorktreeStore },
): GitStoreWithWorkTree;
export function createGitStore(options: CreateGitStoreOptions): GitStore;
export function createGitStore(
  options: CreateGitStoreOptions,
): GitStore | GitStoreWithWorkTree | GitStoreWithFiles {
  const { repository, staging, worktree, files, workTreeRoot } = options;

  // Check if repository is a History facade (has blobs property as Blobs)
  // Both HistoryStore and History have compatible blobs, trees, commits, refs, tags
  const store: GitStore = {
    blobs: repository.blobs as Blobs,
    trees: repository.trees as Trees,
    commits: repository.commits as Commits,
    refs: repository.refs as Refs,
    staging: staging as Staging,
    tags: repository.tags as Tags | undefined,
  };

  if (worktree && files && workTreeRoot !== undefined) {
    return { ...store, worktree: worktree as Worktree, files, workTreeRoot } as GitStoreWithFiles;
  }

  if (worktree) {
    return { ...store, worktree: worktree as Worktree } as GitStoreWithWorkTree;
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

  // Prefer new History/Checkout facades when available
  const blobs = (history?.blobs ?? repository.blobs) as Blobs;
  const trees = (history?.trees ?? repository.trees) as Trees;
  const commits = (history?.commits ?? repository.commits) as Commits;
  const refs = (history?.refs ?? repository.refs) as Refs;
  const tags = (history?.tags ?? repository.tags) as Tags | undefined;
  const effectiveStaging = (checkout?.staging ?? staging) as Staging;

  return {
    history,
    checkout,
    blobs,
    trees,
    commits,
    refs,
    staging: effectiveStaging,
    tags,
    worktree: worktree as Worktree,
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
  /** Immutable history storage (Part 1) - supports both legacy HistoryStore and new History */
  readonly history: HistoryStore | History;

  /** Mutable checkout state (Part 3) - optional for read-only operations */
  readonly checkout?: CheckoutStore | Checkout;

  /** Filesystem access (Part 2) - optional for bare repos */
  readonly worktree?: WorktreeStore | Worktree;

  /** Staging store - required if checkout not provided */
  readonly staging?: StagingStore | Staging;
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
  const checkoutFacade = checkout && "staging" in checkout ? (checkout as Checkout) : undefined;

  const store: GitStore = {
    history: historyFacade,
    checkout: checkoutFacade,
    blobs: history.blobs as Blobs,
    trees: history.trees as Trees,
    commits: history.commits as Commits,
    refs: history.refs as Refs,
    staging: effectiveStaging as Staging,
    tags: history.tags as Tags | undefined,
  };

  if (worktree) {
    return { ...store, worktree: worktree as Worktree } as GitStoreWithWorkTree;
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
