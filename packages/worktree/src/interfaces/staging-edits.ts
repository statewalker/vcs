/**
 * Re-export staging edit classes from @webrun-vcs/vcs
 *
 * These classes are defined in the vcs package to avoid circular dependencies.
 */
export {
  DeleteStagingEntry,
  DeleteStagingTree,
  ResolveStagingConflict,
  SetAssumeValid,
  SetIntentToAdd,
  SetSkipWorktree,
  UpdateStagingEntry,
} from "@webrun-vcs/vcs";
