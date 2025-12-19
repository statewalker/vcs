import type { BlobStore, CommitStore, RefStore, TagStore, TreeStore } from "@webrun-vcs/vcs";
import type { StagingStore, WorkingTreeIterator } from "@webrun-vcs/worktree";

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
  readonly worktree: WorkingTreeIterator;
}
