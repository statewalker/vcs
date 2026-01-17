/**
 * Sync-related actions.
 */

import { newUserAction } from "../utils/index.js";

/**
 * Payload for starting sync with a peer.
 */
export type StartSyncPayload = {
  /** Peer ID to sync with. */
  peerId: string;
};

/**
 * Request to start sync with a peer.
 */
export const [enqueueStartSync, listenStartSync] = newUserAction<StartSyncPayload>("sync:start");

/**
 * Request to cancel ongoing sync.
 */
export const [enqueueCancelSync, listenCancelSync] = newUserAction("sync:cancel");
