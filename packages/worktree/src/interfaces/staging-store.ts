/**
 * Re-export staging store interfaces from @webrun-vcs/vcs
 *
 * These interfaces are defined in the vcs package to avoid circular dependencies.
 */
export {
  MergeStage,
  type MergeStageValue,
  type StagingBuilder,
  type StagingEdit,
  type StagingEditor,
  type StagingEntry,
  type StagingEntryOptions,
  type StagingStore,
} from "@webrun-vcs/vcs";
