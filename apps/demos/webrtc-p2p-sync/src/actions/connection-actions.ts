/**
 * P2P connection-related actions.
 */

import { newUserAction } from "../utils/index.js";

/**
 * Request to start sharing (hosting).
 */
export const [enqueueShare, listenShare] = newUserAction("connection:share");

/**
 * Payload for joining a session.
 */
export type JoinPayload = {
  /** Session ID to join. */
  sessionId: string;
};

/**
 * Request to join a session.
 */
export const [enqueueJoin, listenJoin] = newUserAction<JoinPayload>("connection:join");

/**
 * Request to disconnect from session.
 */
export const [enqueueDisconnect, listenDisconnect] = newUserAction("connection:disconnect");
