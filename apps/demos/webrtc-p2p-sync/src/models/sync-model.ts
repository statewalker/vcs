/**
 * Sync operation state model.
 *
 * Tracks the current sync phase and progress for Git protocol operations.
 */

import { BaseClass, newAdapter } from "../utils/index.js";

/**
 * Current phase of a sync operation (Git protocol phases).
 *
 * Git protocol phases:
 * - idle: No sync in progress
 * - discovering: Discovering remote refs (ref advertisement)
 * - negotiating: Negotiating wants/haves (determining what to transfer)
 * - transferring: Transferring pack data (objects being sent/received)
 * - complete: Sync finished successfully
 * - error: Sync failed
 *
 * Legacy phases (for backwards compatibility with old sync-controller):
 * - receiving: Receiving objects from peer (equivalent to transferring + fetch)
 * - sending: Sending objects to peer (equivalent to transferring + push)
 */
export type SyncPhase =
  | "idle"
  | "discovering"
  | "negotiating"
  | "transferring"
  | "receiving"
  | "sending"
  | "complete"
  | "error";

/**
 * Direction of the sync operation.
 */
export type SyncDirection = "fetch" | "push" | null;

/**
 * Result of a completed sync operation.
 */
export interface SyncResult {
  /** Number of objects received (for fetch). */
  objectsReceived?: number;
  /** Number of objects sent (for push). */
  objectsSent?: number;
  /** Refs that were updated. */
  refsUpdated?: string[];
}

/**
 * Complete sync operation state for Git protocol.
 */
export interface SyncState {
  /** Current sync phase. */
  phase: SyncPhase;
  /** Direction of sync operation. */
  direction: SyncDirection;
  /** ID of the peer we're syncing with. */
  peerId: string | null;

  // Discovery phase
  /** Number of remote refs discovered. */
  remoteRefsCount: number;

  // Negotiation phase
  /** Number of objects we want from remote. */
  wantedObjects: number;
  /** Number of common ancestors found. */
  commonAncestors: number;

  // Transfer phase
  /** Total number of objects to transfer. */
  objectsTotal: number;
  /** Number of objects transferred so far. */
  objectsTransferred: number;
  /** Total bytes transferred. */
  bytesTransferred: number;

  // Result
  /** Result of the completed sync (null if not complete). */
  result: SyncResult | null;
  /** Error message if sync failed. */
  error: string | null;
}

/**
 * Create the initial/idle state.
 */
function createIdleState(): SyncState {
  return {
    phase: "idle",
    direction: null,
    peerId: null,
    remoteRefsCount: 0,
    wantedObjects: 0,
    commonAncestors: 0,
    objectsTotal: 0,
    objectsTransferred: 0,
    bytesTransferred: 0,
    result: null,
    error: null,
  };
}

/**
 * Sync model - tracks sync operation state and progress.
 *
 * This model holds NO business logic. Controllers update this model
 * during sync operations, and views display the progress.
 */
export class SyncModel extends BaseClass {
  private state: SyncState = createIdleState();

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
   *
   * @param peerId ID of the peer we're syncing with
   * @param direction Direction of sync (fetch or push)
   */
  startSync(peerId: string, direction: SyncDirection = "fetch"): void {
    this.state = {
      ...createIdleState(),
      phase: "discovering",
      direction,
      peerId,
    };
    this.notify();
  }

  /**
   * Update discovery phase - remote refs discovered.
   */
  setDiscoveryComplete(remoteRefsCount: number): void {
    this.state.remoteRefsCount = remoteRefsCount;
    this.state.phase = "negotiating";
    this.notify();
  }

  /**
   * Update negotiation phase - wants/haves determined.
   */
  setNegotiationComplete(wantedObjects: number, commonAncestors: number): void {
    this.state.wantedObjects = wantedObjects;
    this.state.commonAncestors = commonAncestors;
    this.state.objectsTotal = wantedObjects;
    this.state.phase = "transferring";
    this.notify();
  }

  /**
   * Update progress during transfer phase.
   */
  updateProgress(objectsTransferred: number, bytesTransferred: number): void {
    this.state.objectsTransferred = objectsTransferred;
    this.state.bytesTransferred = bytesTransferred;
    this.notify();
  }

  /**
   * Mark sync as complete with result.
   */
  complete(result?: SyncResult): void {
    this.state.phase = "complete";
    this.state.result = result ?? null;
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
    this.state = createIdleState();
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
