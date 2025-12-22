/**
 * @webrun-vcs/staging
 *
 * Staging area (index) implementations for WebRun VCS.
 *
 * This package provides implementations of the StagingStore interface
 * defined in @webrun-vcs/core. It includes:
 * - Memory-based staging for testing and ephemeral repositories
 * - File-based staging for Git-compatible persistent storage (in @webrun-vcs/storage-git)
 *
 * Re-exports core staging types for convenience.
 */

// Re-export staging types from core
export {
  MergeStage,
  type MergeStageValue,
  type StagingBuilder,
  type StagingEdit,
  type StagingEditor,
  type StagingEntry,
  type StagingEntryOptions,
  type StagingStore,
} from "@webrun-vcs/core/staging";
// Memory-based staging implementation
export * from "./memory-staging-store.js";
