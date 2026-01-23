/**
 * Git Peer Server - handles incoming Git protocol requests over PeerJS connections.
 *
 * This service wraps a PeerJS DataConnection with the Git protocol server handler,
 * enabling the remote peer to fetch from or push to our local repository.
 */

import { createPeerJsPort } from "@statewalker/vcs-port-peerjs";
import type { RepositoryAccess } from "@statewalker/vcs-transport";
import { handleGitSocketConnection } from "@statewalker/vcs-transport";
import type { PeerConnection } from "../apis/index.js";

/**
 * Options for setting up Git peer server.
 */
export interface GitPeerServerOptions {
  /** The PeerJS DataConnection to serve Git requests over. */
  connection: PeerConnection;
  /** The local repository to serve. */
  repository: RepositoryAccess;
  /** Optional logger for debugging. */
  logger?: {
    debug?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
}

/**
 * Set up a Git protocol server on a PeerJS connection.
 *
 * This allows the remote peer to fetch from or push to our repository
 * using the native Git protocol.
 *
 * @param options - Server options
 * @returns Cleanup function to stop serving
 *
 * @example
 * ```typescript
 * // When a peer connects, set up the server
 * conn.on("open", () => {
 *   const cleanup = setupGitPeerServer({
 *     connection: conn,
 *     repository: repositoryAccess,
 *     logger: console,
 *   });
 *
 *   conn.on("close", cleanup);
 * });
 * ```
 */
export function setupGitPeerServer(options: GitPeerServerOptions): () => void {
  const { connection, repository, logger } = options;

  // Convert PeerJS connection to MessagePort
  // Note: connection should already be open
  const port = createPeerJsPort(connection as unknown as import("peerjs").DataConnection);

  // Track cleanup function from handler
  let handlerCleanup: (() => void) | null = null;

  // Handle the Git socket connection
  handleGitSocketConnection(port, {
    resolveRepository: async (_path: string) => {
      return repository;
    },
    logger,
  })
    .then((cleanup) => {
      handlerCleanup = cleanup;
    })
    .catch((error) => {
      logger?.error?.("Git peer server error:", error);
    });

  // Return cleanup function
  return () => {
    if (handlerCleanup) {
      handlerCleanup();
    }
    port.close();
  };
}
