/**
 * Git Peer Session - manages Git protocol operations over a PeerJS connection.
 *
 * This service provides high-level fetch/push operations using the native Git protocol
 * over a PeerJS DataConnection. It acts as a client that connects to a remote peer
 * that is running a Git server (via setupGitPeerServer).
 */

import type { ObjectId } from "@statewalker/vcs-core";
import { createPeerJsPortAsync } from "@statewalker/vcs-port-peerjs";
import type { RepositoryAccess } from "@statewalker/vcs-transport";
import {
  createGitSocketClient,
  type FetchResult,
  fetch,
  type ProgressInfo,
  type PushResult,
  push,
} from "@statewalker/vcs-transport";
import { bytesToHex, hexToBytes } from "@statewalker/vcs-utils/hash/utils";
import type { PeerConnection } from "../apis/index.js";

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
  /** Progress callback. */
  onProgress?: (phase: string, info: ProgressInfo) => void;
}

/**
 * Options for push operation.
 */
export interface GitPushOptions {
  /** Refspecs to push (default: refs/heads/main:refs/heads/main). */
  refspecs?: string[];
  /** Force push (ignore fast-forward check). */
  force?: boolean;
  /** Progress callback. */
  onProgress?: (phase: string, info: ProgressInfo) => void;
}

/**
 * Result of a fetch operation.
 */
export interface GitFetchResult {
  /** Was the fetch successful? */
  ok: boolean;
  /** Refs that were fetched (name -> object ID hex string). */
  refs: Map<string, string>;
  /** Number of objects received. */
  objectsReceived: number;
  /** Bytes transferred. */
  bytesReceived: number;
  /** Pack data (for importing). */
  packData: Uint8Array;
  /** Error message if failed. */
  error?: string;
}

/**
 * Result of a push operation.
 */
export interface GitPushResult {
  /** Was the push successful? */
  ok: boolean;
  /** Refs that were updated. */
  refsUpdated: string[];
  /** Number of objects sent. */
  objectsSent: number;
  /** Bytes transferred. */
  bytesSent: number;
  /** Error message if failed. */
  error?: string;
}

/**
 * Options for creating a Git peer session.
 */
export interface GitPeerSessionOptions {
  /** The PeerJS DataConnection to use. */
  connection: PeerConnection;
  /** Local repository access (for push operations). */
  repository: RepositoryAccess;
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
 *
 * @example
 * ```typescript
 * const session = await createGitPeerSession({
 *   connection: conn,
 *   repository: repositoryAccess,
 *   onProgress: (phase, msg) => console.log(`[${phase}] ${msg}`),
 * });
 *
 * try {
 *   // Fetch from peer
 *   const result = await session.fetch();
 *   console.log(`Received ${result.objectsReceived} objects`);
 *
 *   // Push to peer
 *   const pushResult = await session.push();
 *   console.log(`Pushed ${pushResult.objectsSent} objects`);
 * } finally {
 *   await session.close();
 * }
 * ```
 */
export async function createGitPeerSession(
  options: GitPeerSessionOptions,
): Promise<GitPeerSession> {
  const { connection, repository, onProgress } = options;

  // Wait for connection to open and create MessagePort
  const port = await createPeerJsPortAsync(
    connection as unknown as import("peerjs").DataConnection,
  );

  let closed = false;

  return {
    async fetch(fetchOptions?: GitFetchOptions): Promise<GitFetchResult> {
      if (closed) {
        throw new Error("Session is closed");
      }

      const refspecs = fetchOptions?.refspecs ?? ["+refs/heads/*:refs/remotes/peer/*"];

      try {
        onProgress?.("discovering", "Connecting to peer...");

        // Create a socket client for this fetch operation
        const client = createGitSocketClient(port, {
          path: "/repo.git",
          service: "git-upload-pack",
        });

        onProgress?.("discovering", "Discovering refs...");

        // Perform the fetch
        const result: FetchResult = await fetch({
          connection: client,
          refspecs,
          onProgress: (info) => {
            if (info.total) {
              onProgress?.("transferring", `Received ${info.current}/${info.total} objects`);
            }
          },
          localHas: async (objectId: Uint8Array) => {
            const hexId = bytesToHex(objectId);
            return repository.hasObject(hexId);
          },
          localCommits: async function* () {
            for await (const ref of repository.listRefs()) {
              if (ref.name.startsWith("refs/heads/")) {
                yield hexToBytes(ref.objectId);
              }
            }
          },
        });

        onProgress?.("complete", "Fetch complete");

        // Convert refs from Uint8Array to hex strings
        const refs = new Map<string, string>();
        for (const [name, objectId] of result.refs) {
          refs.set(name, bytesToHex(objectId));
        }

        return {
          ok: true,
          refs,
          objectsReceived: result.isEmpty ? 0 : estimateObjectCount(result.packData),
          bytesReceived: result.bytesReceived,
          packData: result.packData,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onProgress?.("error", message);
        return {
          ok: false,
          refs: new Map(),
          objectsReceived: 0,
          bytesReceived: 0,
          packData: new Uint8Array(0),
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

        // Create a socket client for this push operation
        const client = createGitSocketClient(port, {
          path: "/repo.git",
          service: "git-receive-pack",
        });

        onProgress?.("discovering", "Discovering refs...");

        // Perform the push
        const result: PushResult = await push({
          connection: client,
          refspecs,
          force,
          onProgress: (info) => {
            if (info.total) {
              onProgress?.("transferring", `Sent ${info.current}/${info.total} objects`);
            }
          },
          getLocalRef: async (refName: string) => {
            for await (const ref of repository.listRefs()) {
              if (ref.name === refName) {
                return ref.objectId;
              }
            }
            return undefined;
          },
          getObjectsToPush: async function* (newIds: string[], oldIds: string[]) {
            const wants = newIds.map((id) => id as ObjectId);
            const haves = oldIds.map((id) => id as ObjectId);

            for await (const obj of repository.walkObjects(wants, haves)) {
              yield {
                id: obj.id,
                type: obj.type,
                content: obj.content,
              };
            }
          },
        });

        onProgress?.("complete", "Push complete");

        return {
          ok: result.ok,
          refsUpdated: Array.from(result.updates.keys()).filter(
            (ref) => result.updates.get(ref)?.ok,
          ),
          objectsSent: result.objectCount,
          bytesSent: result.bytesSent,
          error: result.ok ? undefined : result.unpackStatus,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onProgress?.("error", message);
        return {
          ok: false,
          refsUpdated: [],
          objectsSent: 0,
          bytesSent: 0,
          error: message,
        };
      }
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      port.close();
    },
  };
}

/**
 * Estimate object count from pack data.
 */
function estimateObjectCount(packData: Uint8Array): number {
  if (packData.length < 12) {
    return 0;
  }

  // Pack header: "PACK" (4 bytes) + version (4 bytes) + object count (4 bytes)
  const view = new DataView(packData.buffer, packData.byteOffset, packData.byteLength);
  return view.getUint32(8, false); // Big-endian
}
