/**
 * MessagePortLike interfaces for transport abstraction.
 *
 * The canonical MessagePortLike interface is in @statewalker/vcs-utils.
 * This file re-exports it and provides an extended interface for transports
 * that need backpressure support via bufferedAmount.
 */

// Re-export the canonical MessagePortLike from utils
export type { MessagePortLike } from "@statewalker/vcs-utils";

import type { MessagePortLike } from "@statewalker/vcs-utils";

/**
 * Extended MessagePortLike with bufferedAmount for polling-based backpressure.
 *
 * Use MessagePortLike from utils for the new ACK-based backpressure approach.
 * This interface is for backward compatibility with MessagePortStream.
 */
export interface MessagePortLikeExtended extends MessagePortLike {
  /**
   * Current buffered amount in bytes (for polling-based backpressure).
   * Returns 0 if not supported by the transport.
   */
  readonly bufferedAmount: number;
}
