/**
 * Negotiation state for upload-pack protocol.
 *
 * Tracks common bases between client and server during fetch negotiation,
 * and determines when we're ready to send a pack file.
 *
 * Based on JGit's UploadPack negotiation logic.
 */

import type { ObjectId } from "./types.js";

/**
 * Multi-ACK mode for negotiation.
 * Based on JGit's GitProtocolConstants.MultiAck
 */
export type MultiAckMode = "off" | "continue" | "detailed";

/**
 * Negotiation state during upload-pack.
 */
export interface NegotiationState {
  /** Objects both sides have in common */
  commonBases: Set<ObjectId>;
  /** Objects the client has (PEER_HAS flag in JGit) */
  peerHas: Set<ObjectId>;
  /** Oldest commit time seen (for optimization) */
  oldestTime: number;
  /** Whether we've sent a "ready" signal */
  sentReady: boolean;
  /** Multi-ACK mode negotiated with client */
  multiAckMode: MultiAckMode;
  /** Whether the client supports no-done */
  noDone: boolean;
  /** Last object ID processed */
  lastObjectId: ObjectId | null;
}

/**
 * Create initial negotiation state.
 */
export function createNegotiationState(): NegotiationState {
  return {
    commonBases: new Set(),
    peerHas: new Set(),
    oldestTime: 0,
    sentReady: false,
    multiAckMode: "off",
    noDone: false,
    lastObjectId: null,
  };
}

/**
 * Determine multi-ack mode from client capabilities.
 *
 * Priority: multi_ack_detailed > multi_ack > off
 */
export function determineMultiAckMode(capabilities: Set<string>): MultiAckMode {
  if (capabilities.has("multi_ack_detailed")) {
    return "detailed";
  }
  if (capabilities.has("multi_ack")) {
    return "continue";
  }
  return "off";
}

/**
 * Result of processing a "have" line.
 */
export interface HaveProcessResult {
  /** Object ID that was processed */
  objectId: ObjectId;
  /** Whether we have this object */
  hasObject: boolean;
  /** Whether this is a new common base */
  isNewCommonBase: boolean;
}

/**
 * Generate ACK response for a have line based on multi-ack mode.
 *
 * @param result - Result of processing the have line
 * @param state - Current negotiation state
 * @returns ACK line to send, or null if no ACK needed
 */
export function generateAckResponse(
  result: HaveProcessResult,
  state: NegotiationState,
): string | null {
  if (!result.hasObject) {
    return null;
  }

  if (!result.isNewCommonBase) {
    return null;
  }

  switch (state.multiAckMode) {
    case "off":
      // In non-multi-ack mode, only ACK the first common base
      if (state.commonBases.size === 1) {
        return `ACK ${result.objectId}\n`;
      }
      return null;

    case "continue":
      // In multi_ack mode, ACK every common base with "continue"
      return `ACK ${result.objectId} continue\n`;

    case "detailed":
      // In multi_ack_detailed mode, ACK every common base with "common"
      return `ACK ${result.objectId} common\n`;
  }
}

/**
 * Generate "ready" response when we can give up negotiation.
 *
 * @param objectId - Last object ID to reference
 * @param state - Current negotiation state
 * @returns Ready ACK line, or null if not appropriate for the mode
 */
export function generateReadyResponse(objectId: ObjectId, state: NegotiationState): string | null {
  if (state.multiAckMode === "detailed") {
    return `ACK ${objectId} ready\n`;
  }
  if (state.multiAckMode === "continue") {
    return `ACK ${objectId} continue\n`;
  }
  return null;
}

/**
 * Generate final ACK response after "done".
 *
 * @param state - Current negotiation state
 * @returns Final ACK line, or "NAK" if no common bases
 */
export function generateFinalResponse(state: NegotiationState): string {
  if (state.commonBases.size === 0) {
    return "NAK\n";
  }

  if (state.multiAckMode !== "off" && state.lastObjectId) {
    return `ACK ${state.lastObjectId}\n`;
  }

  return "NAK\n";
}

/**
 * Determine if we can give up negotiation and start sending pack.
 *
 * This is called when we encounter objects we don't have in the have list.
 * We can give up if we have enough common bases to produce a reasonable pack.
 *
 * Based on JGit's okToGiveUp() logic.
 *
 * @param state - Current negotiation state
 * @param wantCount - Number of objects the client wants
 * @returns true if we should stop negotiation
 */
export function canGiveUp(state: NegotiationState, _wantCount: number): boolean {
  // Simple heuristic: if we have at least one common base, we can give up
  // More sophisticated implementations might check commit graph connectivity
  return state.commonBases.size > 0;
}
