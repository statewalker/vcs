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

// ============ Core Type Re-exports ============

/**
 * Re-export WorkingCopy and related types from core for convenience.
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
  /** BlobStore interface - legacy blob storage */
  BlobStore,
  /** Blobs interface - file content storage */
  Blobs,
  /** Checkout interface - mutable local state */
  Checkout,
  /** CommitStore interface - legacy commit storage */
  CommitStore,
  /** Commits interface - commit object storage */
  Commits,
  /** History interface - immutable repository objects */
  History,
  /** RefStore interface - legacy reference storage */
  RefStore,
  /** Refs interface - branch and tag references */
  Refs,
  /** Staging interface - index/staging area */
  Staging,
  /** TagStore interface - legacy tag storage */
  TagStore,
  /** Tags interface - annotated tag storage */
  Tags,
  /** TreeStore interface - legacy tree storage */
  TreeStore,
  /** Trees interface - directory structure storage */
  Trees,
  /** WorkingCopy interface - unified repository access */
  WorkingCopy,
  /** Worktree interface - filesystem access */
  Worktree,
} from "@statewalker/vcs-core";

// ============ Deprecated Types for Backward Compatibility ============

import type {
  BlobStore,
  CommitStore,
  RefStore,
  Staging,
  TagStore,
  TreeStore,
  Worktree,
} from "@statewalker/vcs-core";

/**
 * @deprecated Use WorkingCopy instead. This type exists for backward compatibility with tests.
 *
 * Legacy store interface used by Git.wrap().
 */
export interface GitStore {
  blobs: BlobStore;
  trees: TreeStore;
  commits: CommitStore;
  refs: RefStore;
  staging: Staging;
  tags?: TagStore;
}

/**
 * @deprecated Use WorkingCopy with worktreeInterface instead. This type exists for backward compatibility.
 *
 * Legacy store interface with working tree support.
 */
export interface GitStoreWithWorkTree extends GitStore {
  worktree: Worktree;
}
