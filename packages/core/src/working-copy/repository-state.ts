/**
 * Repository operation state.
 *
 * Tracks in-progress operations that affect what actions are allowed.
 * Based on JGit's RepositoryState enum from lib/RepositoryState.java.
 */
export const RepositoryState = {
  /** Bare repository - no working tree */
  BARE: "bare",
  /** Normal safe state */
  SAFE: "safe",
  /** Merge in progress with unresolved conflicts */
  MERGING: "merging",
  /** Merge resolved, ready to commit */
  MERGING_RESOLVED: "merging-resolved",
  /** Cherry-pick in progress with conflicts */
  CHERRY_PICKING: "cherry-picking",
  /** Cherry-pick resolved, ready to commit */
  CHERRY_PICKING_RESOLVED: "cherry-picking-resolved",
  /** Revert in progress with conflicts */
  REVERTING: "reverting",
  /** Revert resolved, ready to commit */
  REVERTING_RESOLVED: "reverting-resolved",
  /** Rebase in progress (git am style) */
  REBASING: "rebasing",
  /** Rebase in progress (merge strategy) */
  REBASING_MERGE: "rebasing-merge",
  /** Interactive rebase in progress */
  REBASING_INTERACTIVE: "rebasing-interactive",
  /** Git am (apply mailbox) in progress */
  APPLY: "apply",
  /** Bisect in progress */
  BISECTING: "bisecting",
} as const;

export type RepositoryStateValue = (typeof RepositoryState)[keyof typeof RepositoryState];

/**
 * Capability queries for repository state.
 *
 * Determines what operations are allowed in the current state.
 */
export interface StateCapabilities {
  /** Can checkout to another branch/commit */
  readonly canCheckout: boolean;
  /** Can create commits */
  readonly canCommit: boolean;
  /** Can reset HEAD */
  readonly canResetHead: boolean;
  /** Can amend last commit */
  readonly canAmend: boolean;
  /** Is a rebase operation in progress */
  readonly isRebasing: boolean;
}

/**
 * Get capabilities for a repository state.
 *
 * Determines what operations are allowed based on the current state.
 * Logic follows JGit's RepositoryState capability methods.
 *
 * @param state The repository state to query
 * @returns Capabilities object indicating allowed operations
 */
export function getStateCapabilities(state: RepositoryStateValue): StateCapabilities {
  switch (state) {
    case RepositoryState.BARE:
      return {
        canCheckout: false,
        canCommit: false,
        canResetHead: false,
        canAmend: false,
        isRebasing: false,
      };

    case RepositoryState.SAFE:
      return {
        canCheckout: true,
        canCommit: true,
        canResetHead: true,
        canAmend: true,
        isRebasing: false,
      };

    case RepositoryState.MERGING:
      return {
        canCheckout: false,
        canCommit: false,
        canResetHead: true,
        canAmend: false,
        isRebasing: false,
      };

    case RepositoryState.MERGING_RESOLVED:
      return {
        canCheckout: false,
        canCommit: true,
        canResetHead: true,
        canAmend: false,
        isRebasing: false,
      };

    case RepositoryState.CHERRY_PICKING:
      return {
        canCheckout: false,
        canCommit: false,
        canResetHead: true,
        canAmend: false,
        isRebasing: false,
      };

    case RepositoryState.CHERRY_PICKING_RESOLVED:
      return {
        canCheckout: false,
        canCommit: true,
        canResetHead: true,
        canAmend: false,
        isRebasing: false,
      };

    case RepositoryState.REVERTING:
      return {
        canCheckout: false,
        canCommit: false,
        canResetHead: true,
        canAmend: false,
        isRebasing: false,
      };

    case RepositoryState.REVERTING_RESOLVED:
      return {
        canCheckout: false,
        canCommit: true,
        canResetHead: true,
        canAmend: false,
        isRebasing: false,
      };

    case RepositoryState.REBASING:
    case RepositoryState.REBASING_MERGE:
    case RepositoryState.REBASING_INTERACTIVE:
      return {
        canCheckout: false,
        canCommit: false,
        canResetHead: false,
        canAmend: true,
        isRebasing: true,
      };

    case RepositoryState.APPLY:
      return {
        canCheckout: false,
        canCommit: false,
        canResetHead: false,
        canAmend: true,
        isRebasing: false,
      };

    case RepositoryState.BISECTING:
      return {
        canCheckout: true,
        canCommit: false,
        canResetHead: false,
        canAmend: false,
        isRebasing: false,
      };

    default: {
      const _exhaustive: never = state;
      throw new Error(`Unknown repository state: ${_exhaustive}`);
    }
  }
}
