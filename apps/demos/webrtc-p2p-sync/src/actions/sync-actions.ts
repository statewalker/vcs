/**
 * Sync-related actions.
 */

import { newUserAction } from "../models/user-actions-model.js";

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
export const [enqueueStartSyncAction, listenStartSyncAction] =
  newUserAction<StartSyncPayload>("sync:start");

/**
 * Request to cancel ongoing sync.
 */
export const [enqueueCancelSyncAction, listenCancelSyncAction] = newUserAction("sync:cancel");
