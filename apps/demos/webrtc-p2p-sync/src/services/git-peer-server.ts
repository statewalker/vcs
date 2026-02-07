/**
 * Git Peer Server - handles incoming Git protocol requests over PeerJS connections.
 *
 * Uses the new transport Duplex API (serveOverDuplex) for transport-agnostic
 * Git protocol serving over PeerJS DataConnections.
 *
 * The server waits for a service-type handshake byte from the client before
 * starting the FSM. This prevents the server from writing (ref advertisement)
 * before the client is ready to receive.
 */

import type { History, SerializationApi } from "@statewalker/vcs-core";
import type { RefStore, RepositoryFacade } from "@statewalker/vcs-transport";
import { serveOverDuplex } from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";
import { createRefStoreAdapter, waitForClientService } from "../adapters/index.js";
import type { PeerConnection } from "../apis/index.js";

/**
 * Options for setting up Git peer server.
 */
export interface GitPeerServerOptions {
  /** The PeerJS DataConnection to serve Git requests over. */
  connection: PeerConnection;
  /** Local repository history. */
  history: History;
  /** Serialization API for pack operations. */
  serialization: SerializationApi;
  /** Optional logger for debugging. */
  logger?: {
    debug?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
}

/**
 * Set up a Git protocol server on a PeerJS connection.
 *
 * The server waits for client requests via a service-type handshake.
 * Each time the client sends a service byte, the server starts the
 * appropriate FSM (upload-pack or receive-pack). This allows multiple
 * sequential operations (fetch then push) on the same connection.
 *
 * @param options - Server options
 * @returns Cleanup function to stop serving
 */
export function setupGitPeerServer(options: GitPeerServerOptions): () => void {
  const { connection, history, serialization, logger } = options;

  const repository: RepositoryFacade = createVcsRepositoryFacade({ history, serialization });
  const refStore: RefStore = createRefStoreAdapter(history.refs);

  let stopped = false;

  // Serve requests in a loop: wait for client handshake, serve, repeat
  async function serveLoop(): Promise<void> {
    while (!stopped) {
      try {
        // Wait for client to send service type byte
        const { duplex, service } = await waitForClientService(connection);

        if (stopped) {
          await duplex.close?.();
          break;
        }

        logger?.debug?.(`Git server: client requested ${service}`);

        // Serve the requested service
        const result = await serveOverDuplex({
          duplex,
          repository,
          refStore,
          service,
        });

        if (!result.success) {
          logger?.error?.(`Git server ${service} error:`, result.error);
        } else {
          logger?.debug?.(`Git server ${service} complete, objects sent:`, result.objectsSent);
        }
      } catch (error) {
        if (!stopped) {
          logger?.error?.("Git peer server error:", error);
        }
        // Small delay before retrying to avoid tight error loops
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  serveLoop().catch((error) => {
    if (!stopped) {
      logger?.error?.("Git peer server loop error:", error);
    }
  });

  // Return cleanup function
  return () => {
    stopped = true;
  };
}
