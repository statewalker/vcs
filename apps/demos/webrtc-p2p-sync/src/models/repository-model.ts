/**
 * Repository state model.
 *
 * Tracks the state of the local Git repository.
 */

import { Base, newAdapter } from "../utils/index.js";

/**
 * A file or directory entry in the repository.
 */
export interface FileEntry {
  /** File/directory name. */
  name: string;
  /** Full path from repository root. */
  path: string;
  /** Entry type. */
  type: "file" | "directory";
  /** File mode (e.g., 0o100644 for regular file). */
  mode?: number;
  /** Object ID (blob or tree hash). */
  id?: string;
}

/**
 * A commit in the repository history.
 */
export interface CommitEntry {
  /** Commit ID (SHA-1 hash). */
  id: string;
  /** Commit message. */
  message: string;
  /** Author name. */
  author: string;
  /** Commit timestamp. */
  timestamp: Date;
}

/**
 * Complete repository state.
 */
export interface RepositoryState {
  /** Whether a repository has been initialized. */
  initialized: boolean;
  /** Current branch name (e.g., "main"). */
  branch: string | null;
  /** Number of commits in history. */
  commitCount: number;
  /** Files in the HEAD commit tree. */
  files: FileEntry[];
  /** HEAD commit ID. */
  headCommitId: string | null;
  /** Recent commits (for display). */
  commits: CommitEntry[];
  /** Files staged for commit (added or changed in index). */
  staged: string[];
  /** Files modified but not staged (changed in working dir). */
  unstaged: string[];
  /** Untracked files (not in index or HEAD). */
  untracked: string[];
}

/**
 * Repository model - tracks Git repository state.
 *
 * This model holds NO business logic. Controllers update this model
 * after performing Git operations.
 */
export class RepositoryModel extends Base {
  private state: RepositoryState = {
    initialized: false,
    branch: null,
    commitCount: 0,
    files: [],
    headCommitId: null,
    commits: [],
    staged: [],
    unstaged: [],
    untracked: [],
  };

  /**
   * Get the current state (readonly).
   */
  getState(): Readonly<RepositoryState> {
    return this.state;
  }

  /**
   * Update multiple fields at once (single notification).
   */
  update(partial: Partial<RepositoryState>): void {
    return this.update(() => {
      Object.assign(this.state, partial);
    
    });
  }

  /**
   * Set initialized state.
   */
  setInitialized(initialized: boolean): void {
    return this.update(() => {
      this.state.initialized = initialized;
    
    });
  }

  /**
   * Set current branch.
   */
  setBranch(branch: string | null): void {
    return this.update(() => {
      this.state.branch = branch;
    
    });
  }

  /**
   * Set files in the repository.
   */
  setFiles(files: FileEntry[]): void {
    return this.update(() => {
      this.state.files = files;
    
    });
  }

  /**
   * Set HEAD commit ID.
   */
  setHeadCommitId(id: string | null): void {
    return this.update(() => {
      this.state.headCommitId = id;
    
    });
  }

  /**
   * Set commit history.
   */
  setCommits(commits: CommitEntry[]): void {
    return this.update(() => {
      this.state.commits = commits;
      this.state.commitCount = commits.length;
    
    });
  }

  /**
   * Add a new commit to history.
   */
  addCommit(commit: CommitEntry): void {
    return this.update(() => {
      this.state.commits.unshift(commit);
      this.state.commitCount = this.state.commits.length;
      this.state.headCommitId = commit.id;
    
    });
  }

  /**
   * Reset repository state.
   */
  reset(): void {
    return this.update(() => {
      this.state = {
        initialized: false,
        branch: null,
        commitCount: 0,
        files: [],
        headCommitId: null,
        commits: [],
        staged: [],
        unstaged: [],
        untracked: [],
      };
    
    });
  }
}

/**
 * Context adapter for RepositoryModel.
 */
export const [getRepositoryModel, setRepositoryModel] = newAdapter<RepositoryModel>(
  "repository-model",
  () => new RepositoryModel(),
);
