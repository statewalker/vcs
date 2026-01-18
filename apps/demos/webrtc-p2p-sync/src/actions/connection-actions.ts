/**
 * P2P connection-related actions.
 */

import { newUserAction } from "../models/user-actions-model.js";

/**
 * Request to start sharing (hosting).
 */
export const [enqueueShareAction, listenShareAction] = newUserAction("connection:share");

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
export const [enqueueJoinAction, listenJoinAction] = newUserAction<JoinPayload>("connection:join");

/**
 * Request to disconnect from session.
 */
export const [enqueueDisconnectAction, listenDisconnectAction] =
  newUserAction("connection:disconnect");
