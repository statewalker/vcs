import type { ObjectId } from "@statewalker/vcs-core";

import type { FetchResult } from "./fetch-result.js";

/**
 * Result of a clone operation.
 *
 * Based on JGit's CloneCommand result (returns Git instance).
 */
export interface CloneResult {
  /** The fetch result containing refs and pack data */
  fetchResult: FetchResult;
  /** Default branch that was checked out (may be undefined for empty repos) */
  defaultBranch?: string;
  /** Remote name used (typically "origin") */
  remoteName: string;
  /** Whether this was a bare clone */
  bare: boolean;
  /** Head commit after clone */
  headCommit?: ObjectId;
}
