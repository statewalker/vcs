/**
 * Git Peer Session - manages Git protocol operations over a PeerJS connection.
 *
 * Uses the new transport Duplex API (fetchOverDuplex/pushOverDuplex) for
 * transport-agnostic Git protocol operations over PeerJS DataConnections.
 */

import type { History, SerializationApi } from "@statewalker/vcs-core";
import type { RefStore, RepositoryFacade } from "@statewalker/vcs-transport";
import { fetchOverDuplex, pushOverDuplex } from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";
import { createMessagePortClientDuplex, createRefStoreAdapter } from "../adapters/index.js";

/**
 * Interface for the Git peer session.
 */
export interface GitPeerSession {
  /** Fetch refs and objects from peer. */
  fetch(options?: GitFetchOptions): Promise<GitFetchResult>;

  /** Push refs and objects to peer. */
  push(options?: GitPushOptions): Promise<GitPushResult>;

  /** Close the session and release resources. */
  close(): Promise<void>;
}

/**
 * Options for fetch operation.
 */
export interface GitFetchOptions {
  /** Refspecs to fetch (default: +refs/heads/*:refs/remotes/peer/*). */
  refspecs?: string[];
}

/**
 * Options for push operation.
 */
export interface GitPushOptions {
  /** Refspecs to push (default: refs/heads/main:refs/heads/main). */
  refspecs?: string[];
  /** Force push (ignore fast-forward check). */
  force?: boolean;
}

/**
 * Result of a fetch operation.
 */
export interface GitFetchResult {
  /** Was the fetch successful? */
  ok: boolean;
  /** Refs that were updated (name -> object ID hex string). */
  refs: Map<string, string>;
  /** Number of objects received. */
  objectsReceived: number;
  /** Error message if failed. */
  error?: string;
}

/**
 * Result of a push operation.
 */
export interface GitPushResult {
  /** Was the push successful? */
  ok: boolean;
  /** Error message if failed. */
  error?: string;
}

/**
 * Options for creating a Git peer session.
 */
export interface GitPeerSessionOptions {
  /** The MessagePort to communicate over. */
  port: MessagePort;
  /** Local repository history. */
  history: History;
  /** Serialization API for pack operations. */
  serialization: SerializationApi;
  /** Progress callback for sync phases. */
  onProgress?: (phase: string, message: string) => void;
}

/**
 * Create a Git peer session for performing fetch/push operations.
 *
 * The session wraps a PeerJS connection and provides high-level Git
 * protocol operations. The remote peer must be running a Git server
 * (via setupGitPeerServer).
 *
 * @param options - Session options
 * @returns A GitPeerSession instance
 */
export function createGitPeerSession(options: GitPeerSessionOptions): GitPeerSession {
  const { port, history, serialization, onProgress } = options;

  const repository: RepositoryFacade = createVcsRepositoryFacade({ history, serialization });
  const refStore: RefStore = createRefStoreAdapter(history.refs);

  let closed = false;

  return {
    async fetch(fetchOptions?: GitFetchOptions): Promise<GitFetchResult> {
      if (closed) {
        throw new Error("Session is closed");
      }

      const refspecs = fetchOptions?.refspecs ?? ["+refs/heads/*:refs/remotes/peer/*"];

      try {
        onProgress?.("discovering", "Connecting to peer...");

        // Create client duplex with service handshake (triggers server)
        const duplex = createMessagePortClientDuplex(port, "git-upload-pack");

        onProgress?.("transferring", "Fetching from peer...");

        const result = await fetchOverDuplex({
          duplex,
          repository,
          refStore,
          refspecs,
        });

        if (!result.success) {
          throw new Error(result.error ?? "Fetch failed");
        }

        onProgress?.("complete", "Fetch complete");

        return {
          ok: true,
          refs: result.updatedRefs ?? new Map(),
          objectsReceived: result.objectsImported ?? 0,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onProgress?.("error", message);
        return {
          ok: false,
          refs: new Map(),
          objectsReceived: 0,
          error: message,
        };
      }
    },

    async push(pushOptions?: GitPushOptions): Promise<GitPushResult> {
      if (closed) {
        throw new Error("Session is closed");
      }

      const refspecs = pushOptions?.refspecs ?? ["refs/heads/main:refs/heads/main"];
      const force = pushOptions?.force ?? false;

      try {
        onProgress?.("discovering", "Connecting to peer...");

        // Create client duplex with service handshake (triggers server)
        const duplex = createMessagePortClientDuplex(port, "git-receive-pack");

        onProgress?.("transferring", "Pushing to peer...");

        const result = await pushOverDuplex({
          duplex,
          repository,
          refStore,
          refspecs,
          force,
        });

        if (!result.success) {
          throw new Error(result.error ?? "Push failed");
        }

        onProgress?.("complete", "Push complete");

        return {
          ok: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onProgress?.("error", message);
        return {
          ok: false,
          error: message,
        };
      }
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
    },
  };
}
