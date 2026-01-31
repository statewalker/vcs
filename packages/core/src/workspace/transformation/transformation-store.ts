/**
 * Unified store for all transformation operations.
 *
 * Provides a single interface for managing merge, rebase, cherry-pick,
 * and revert operations, with detection of which operation is in progress.
 */

import type { FilesApi } from "@statewalker/vcs-utils/files";
import type { CherryPickStateStore } from "./cherry-pick-state-store.js";
import { GitCherryPickStateStore } from "./cherry-pick-state-store.js";
import type { MergeStateStore } from "./merge-state-store.js";
import { GitMergeStateStore } from "./merge-state-store.js";
import type { RebaseStateStore } from "./rebase-state-store.js";
import { GitRebaseStateStore } from "./rebase-state-store.js";
import type { RevertStateStore } from "./revert-state-store.js";
import { GitRevertStateStore } from "./revert-state-store.js";
import type { SequencerStore } from "./sequencer-store.js";
import { GitSequencerStore } from "./sequencer-store.js";
import type { TransformationCapabilities, TransformationState } from "./types.js";

/**
 * Unified store for all transformation operations
 *
 * Provides a single interface for managing merge, rebase, cherry-pick,
 * and revert operations, with detection of which operation is in progress.
 */
export interface TransformationStore {
  /** Merge state operations */
  readonly merge: MergeStateStore;

  /** Rebase state operations */
  readonly rebase: RebaseStateStore;

  /** Cherry-pick state operations */
  readonly cherryPick: CherryPickStateStore;

  /** Revert state operations */
  readonly revert: RevertStateStore;

  /** Sequencer for multi-commit operations */
  readonly sequencer: SequencerStore;

  /**
   * Get current transformation state (if any)
   *
   * Detection priority:
   * 1. Rebase (most restrictive)
   * 2. Merge
   * 3. Cherry-pick
   * 4. Revert
   */
  getState(): Promise<TransformationState | undefined>;

  /**
   * Get capabilities for current state
   */
  getCapabilities(): Promise<TransformationCapabilities>;

  /**
   * Check if any operation is in progress
   */
  hasOperationInProgress(): Promise<boolean>;

  /**
   * Abort current operation (whatever it is)
   */
  abortCurrent(): Promise<void>;
}

/**
 * Git file-based TransformationStore implementation
 */
export class GitTransformationStore implements TransformationStore {
  readonly merge: MergeStateStore;
  readonly rebase: RebaseStateStore;
  readonly cherryPick: CherryPickStateStore;
  readonly revert: RevertStateStore;
  readonly sequencer: SequencerStore;

  constructor(files: FilesApi, gitDir: string) {
    this.merge = new GitMergeStateStore(files, gitDir);
    this.rebase = new GitRebaseStateStore(files, gitDir);
    this.cherryPick = new GitCherryPickStateStore(files, gitDir);
    this.revert = new GitRevertStateStore(files, gitDir);
    this.sequencer = new GitSequencerStore(files, gitDir);
  }

  async getState(): Promise<TransformationState | undefined> {
    // Check in priority order

    // 1. Rebase (most restrictive)
    const rebaseState = await this.rebase.read();
    if (rebaseState) return rebaseState;

    // 2. Merge
    const mergeState = await this.merge.read();
    if (mergeState) return mergeState;

    // 3. Cherry-pick
    const cherryPickState = await this.cherryPick.read();
    if (cherryPickState) return cherryPickState;

    // 4. Revert
    const revertState = await this.revert.read();
    if (revertState) return revertState;

    return undefined;
  }

  async getCapabilities(): Promise<TransformationCapabilities> {
    const state = await this.getState();

    if (!state) {
      return {
        canContinue: false,
        canSkip: false,
        canAbort: false,
        canQuit: false,
        hasConflicts: false,
      };
    }

    // Base capabilities depend on operation type
    switch (state.type) {
      case "merge":
        return {
          canContinue: true,
          canSkip: false,
          canAbort: true,
          canQuit: false,
          hasConflicts: true, // Merge always implies conflicts if in progress
        };

      case "rebase":
        return {
          canContinue: true,
          canSkip: true,
          canAbort: true,
          canQuit: state.interactive,
          hasConflicts: true,
        };

      case "cherry-pick":
      case "revert": {
        const hasSequencer = await this.sequencer.isInProgress();
        return {
          canContinue: true,
          canSkip: hasSequencer,
          canAbort: true,
          canQuit: hasSequencer,
          hasConflicts: true,
        };
      }
    }
  }

  async hasOperationInProgress(): Promise<boolean> {
    return (
      (await this.rebase.isInProgress()) ||
      (await this.merge.isInProgress()) ||
      (await this.cherryPick.isInProgress()) ||
      (await this.revert.isInProgress())
    );
  }

  async abortCurrent(): Promise<void> {
    const state = await this.getState();
    if (!state) return;

    switch (state.type) {
      case "merge":
        await this.merge.abort();
        break;
      case "rebase":
        await this.rebase.abort();
        break;
      case "cherry-pick":
        await this.cherryPick.abort();
        await this.sequencer.abort();
        break;
      case "revert":
        await this.revert.abort();
        await this.sequencer.abort();
        break;
    }
  }
}

/**
 * Factory function for creating TransformationStore
 *
 * @param files FilesApi implementation
 * @param gitDir Path to .git directory
 */
export function createTransformationStore(files: FilesApi, gitDir: string): TransformationStore {
  return new GitTransformationStore(files, gitDir);
}
