import type { PackImportResult } from "../api/repository-facade.js";

/**
 * Output values produced by FSM handlers.
 *
 * Handlers write results here during execution.
 * Used for:
 * - Error reporting
 * - Progress tracking
 * - Final results
 */
export class HandlerOutput {
  /**
   * Error message if an operation failed.
   * When set, FSM typically transitions to error state.
   */
  error?: string;

  /**
   * Last acknowledged object ID from server.
   * Updated during ACK/NAK negotiation.
   */
  lastAckOid?: string;

  /**
   * Result from pack import operation.
   * Set after successfully receiving and importing a pack.
   */
  packResult?: PackImportResult;

  /**
   * Whether server sent "ACK ... ready".
   * Indicates pack is ready without waiting for "done".
   * Used with no-done capability.
   */
  receivedReady?: boolean;

  /**
   * Number of "have" commands sent during negotiation.
   * Used to enforce maxHaves limit.
   */
  havesSent?: number;

  /**
   * Number of haves sent since last "continue" ACK.
   * Used for early termination optimization.
   */
  havesSinceLastContinue?: number;

  /**
   * Whether a "continue" ACK was received.
   * Indicates server found some common objects.
   */
  receivedContinue?: boolean;

  /**
   * Resets all output values.
   */
  reset(): void {
    this.error = undefined;
    this.lastAckOid = undefined;
    this.packResult = undefined;
    this.receivedReady = undefined;
    this.havesSent = undefined;
    this.havesSinceLastContinue = undefined;
    this.receivedContinue = undefined;
  }
}
