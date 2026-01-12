import type { HistoryStore } from "@statewalker/vcs-core";

import type { Git } from "../git.js";
import type { GitStore } from "../types.js";

/**
 * Result of repository initialization.
 *
 * Based on JGit's InitCommand result (returns Git instance).
 */
export interface InitResult {
  /** Git facade for command execution */
  git: Git;

  /** GitStore for direct store access */
  store: GitStore;

  /** The underlying HistoryStore (repository) */
  repository: HistoryStore;

  /** Initial branch name */
  initialBranch: string;

  /** Whether this is a bare repository */
  bare: boolean;

  /** Path to the .git directory */
  gitDir: string;
}
