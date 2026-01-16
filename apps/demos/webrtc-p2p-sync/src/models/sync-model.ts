/**
 * Sync operation state model.
 *
 * Tracks the current sync phase and progress.
 */

import { BaseClass, newAdapter } from "../utils/index.js";

/**
 * Current phase of a sync operation.
 */
export type SyncPhase = "idle" | "negotiating" | "receiving" | "sending" | "complete" | "error";

/**
 * Complete sync operation state.
 */
export interface SyncState {
  /** Current sync phase. */
  phase: SyncPhase;
  /** ID of the peer we're syncing with. */
  peerId: string | null;
  /** Total number of objects to transfer. */
  objectsTotal: number;
  /** Number of objects transferred so far. */
  objectsTransferred: number;
  /** Total bytes transferred. */
  bytesTransferred: number;
  /** Error message if sync failed. */
  error: string | null;
}

/**
 * Sync model - tracks sync operation state and progress.
 *
 * This model holds NO business logic. Controllers update this model
 * during sync operations, and views display the progress.
 */
export class SyncModel extends BaseClass {
  private state: SyncState = {
    phase: "idle",
    peerId: null,
    objectsTotal: 0,
    objectsTransferred: 0,
    bytesTransferred: 0,
    error: null,
  };

  /**
   * Get the current state (readonly).
   */
  getState(): Readonly<SyncState> {
    return this.state;
  }

  /**
   * Check if a sync is currently in progress.
   */
  get isActive(): boolean {
    return (
      this.state.phase !== "idle" && this.state.phase !== "complete" && this.state.phase !== "error"
    );
  }

  /**
   * Get progress as a percentage (0-100).
   */
  get progressPercent(): number {
    if (this.state.objectsTotal === 0) return 0;
    return Math.round((this.state.objectsTransferred / this.state.objectsTotal) * 100);
  }

  /**
   * Update multiple fields at once (single notification).
   */
  update(partial: Partial<SyncState>): void {
    Object.assign(this.state, partial);
    this.notify();
  }

  /**
   * Start a new sync operation.
   */
  startSync(peerId: string): void {
    this.state = {
      phase: "negotiating",
      peerId,
      objectsTotal: 0,
      objectsTransferred: 0,
      bytesTransferred: 0,
      error: null,
    };
    this.notify();
  }

  /**
   * Update progress during sync.
   */
  updateProgress(objectsTransferred: number, objectsTotal: number, bytesTransferred: number): void {
    this.state.objectsTransferred = objectsTransferred;
    this.state.objectsTotal = objectsTotal;
    this.state.bytesTransferred = bytesTransferred;
    this.notify();
  }

  /**
   * Mark sync as complete.
   */
  complete(): void {
    this.state.phase = "complete";
    this.notify();
  }

  /**
   * Mark sync as failed.
   */
  fail(error: string): void {
    this.state.phase = "error";
    this.state.error = error;
    this.notify();
  }

  /**
   * Reset to idle state.
   */
  reset(): void {
    this.state = {
      phase: "idle",
      peerId: null,
      objectsTotal: 0,
      objectsTransferred: 0,
      bytesTransferred: 0,
      error: null,
    };
    this.notify();
  }
}

/**
 * Context adapter for SyncModel.
 */
export const [getSyncModel, setSyncModel] = newAdapter<SyncModel>(
  "sync-model",
  () => new SyncModel(),
);
