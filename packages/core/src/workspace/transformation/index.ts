/**
 * Transformation operations state management.
 *
 * Provides unified state management for merge, rebase, cherry-pick,
 * and revert operations, with support for crash recovery and
 * multi-commit sequencing.
 */

// Cherry-pick state store
export type { CherryPickStateStore } from "./cherry-pick-state-store.js";
export {
  createCherryPickStateStore,
  GitCherryPickStateStore,
} from "./cherry-pick-state-store.js";
// Merge state store
export type { MergeStateStore } from "./merge-state-store.js";
export {
  createMergeStateStore,
  GitMergeStateStore,
} from "./merge-state-store.js";
// Rebase state store
export type { RebaseStateStore } from "./rebase-state-store.js";
export {
  createRebaseStateStore,
  GitRebaseStateStore,
} from "./rebase-state-store.js";
// Revert state store
export type { RevertStateStore } from "./revert-state-store.js";
export {
  createRevertStateStore,
  GitRevertStateStore,
} from "./revert-state-store.js";
// Sequencer store
export type { SequencerStore } from "./sequencer-store.js";
export {
  createSequencerStore,
  GitSequencerStore,
} from "./sequencer-store.js";
// Unified transformation store
export type { TransformationStore } from "./transformation-store.js";
export {
  createTransformationStore,
  GitTransformationStore,
} from "./transformation-store.js";
// Types
export type {
  CherryPickState,
  MergeState,
  OperationState,
  OperationType,
  RebaseState,
  RebaseTodoAction,
  RebaseTodoItem,
  RebaseType,
  RevertState,
  SequencerOptions,
  SequencerState,
  SequencerTodoItem,
  TransformationCapabilities,
  TransformationState,
} from "./types.js";
