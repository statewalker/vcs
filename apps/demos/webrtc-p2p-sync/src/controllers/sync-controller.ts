/**
 * Sync controller - orchestrates Git synchronization over WebRTC.
 *
 * Uses native Git protocol (upload-pack/receive-pack) for efficient sync:
 * - Only transfers missing objects (proper negotiation)
 * - Uses packfile format (delta compression)
 * - Standard Git protocol (interoperable)
 *
 * Flow:
 * 1. Host sets up Git server on each incoming connection
 * 2. When user clicks sync, client performs fetch from peer
 * 3. Pack data is imported into local repository
 * 4. Local refs are updated
 */

import type { RepositoryAccess } from "@statewalker/vcs-transport";
import {
  enqueueCheckoutAction,
  enqueueRefreshRepoAction,
  listenCancelSyncAction,
  listenStartSyncAction,
} from "../actions/index.js";
import type { PeerConnection } from "../apis/index.js";
import { getTimerApi } from "../apis/index.js";
import {
  getActivityLogModel,
  getPeersModel,
  getSyncModel,
  getUserActionsModel,
} from "../models/index.js";
import {
  createGitPeerSession,
  type GitPeerSession,
  setupGitPeerServer,
} from "../services/index.js";
import { newRegistry } from "../utils/index.js";
import type { AppContext } from "./index.js";
import { getPeerConnections, getRepository, getRepositoryAccess } from "./index.js";

// How long to show "complete" state before resetting
const COMPLETE_DISPLAY_MS = 2000;

/**
 * Create the sync controller.
 *
 * @param ctx The application context
 * @returns Cleanup function
 */
export function createSyncController(ctx: AppContext): () => void {
  const [register, cleanup] = newRegistry();

  // Get models
  const syncModel = getSyncModel(ctx);
  const peersModel = getPeersModel(ctx);
  const logModel = getActivityLogModel(ctx);
  const actionsModel = getUserActionsModel(ctx);

  // Get APIs
  const timerApi = getTimerApi(ctx);

  // Get peer connections
  const connections = getPeerConnections(ctx);

  // Track active Git servers (one per incoming connection)
  const gitServers = new Map<string, () => void>();

  // Track active sync sessions
  const activeSessions = new Map<string, GitPeerSession>();

  // Set up Git servers when peers connect
  register(
    peersModel.onUpdate(() => {
      const repositoryAccess = getRepositoryAccess(ctx);
      if (!repositoryAccess) return;

      // Set up Git server for each connected peer
      for (const [peerId, conn] of connections) {
        setupGitServerForPeer(peerId, conn, repositoryAccess);
      }

      // Clean up servers for disconnected peers
      for (const peerId of gitServers.keys()) {
        if (!connections.has(peerId)) {
          cleanupGitServer(peerId);
        }
      }
    }),
  );

  /**
   * Set up Git server for a peer connection.
   */
  function setupGitServerForPeer(
    peerId: string,
    conn: PeerConnection,
    repositoryAccess: RepositoryAccess,
  ): void {
    if (gitServers.has(peerId)) return;

    const displayName = peersModel.get(peerId)?.displayName ?? peerId;
    logModel.info(`Setting up Git server for ${displayName}`);

    try {
      const cleanup = setupGitPeerServer({
        connection: conn,
        repository: repositoryAccess,
        logger: {
          debug: (...args) => logModel.info(`[Git Server] ${args.join(" ")}`),
          error: (...args) => logModel.error(`[Git Server] ${args.join(" ")}`),
        },
      });

      gitServers.set(peerId, cleanup);
    } catch (error) {
      logModel.error(`Failed to set up Git server for ${displayName}: ${(error as Error).message}`);
    }
  }

  /**
   * Clean up Git server for a peer.
   */
  function cleanupGitServer(peerId: string): void {
    const cleanup = gitServers.get(peerId);
    if (cleanup) {
      cleanup();
      gitServers.delete(peerId);
    }
  }

  // Listen to user actions
  register(
    listenStartSyncAction(actionsModel, (actions) => {
      for (const { peerId } of actions) {
        handleSyncStart(peerId);
      }
    }),
  );

  register(
    listenCancelSyncAction(actionsModel, () => {
      handleSyncCancel();
    }),
  );

  /**
   * Start sync with a peer (fetch their data).
   */
  async function handleSyncStart(peerId: string): Promise<void> {
    // Don't start if already syncing
    if (syncModel.isActive) {
      logModel.warn("Sync already in progress");
      return;
    }

    // Get the peer connection
    const conn = connections.get(peerId);
    if (!conn) {
      logModel.error(`Peer ${peerId} not connected`);
      return;
    }

    // Get repository access
    const repositoryAccess = getRepositoryAccess(ctx);
    if (!repositoryAccess) {
      logModel.error("Repository not initialized");
      return;
    }

    const displayName = peersModel.get(peerId)?.displayName ?? peerId;
    logModel.info(`Starting sync with ${displayName}...`);

    // Start sync (discovering phase)
    syncModel.startSync(peerId, "fetch");

    try {
      // Create Git peer session
      const session = await createGitPeerSession({
        connection: conn,
        repository: repositoryAccess,
        onProgress: (phase, message) => {
          logModel.info(`[Sync] ${phase}: ${message}`);
          // Update sync model based on phase
          if (phase === "discovering") {
            // Already in discovering phase from startSync
          } else if (phase === "transferring") {
            syncModel.update({ phase: "transferring" });
          }
        },
      });

      activeSessions.set(peerId, session);

      // Perform fetch
      syncModel.setDiscoveryComplete(0); // We don't know ref count until fetch completes

      const fetchResult = await session.fetch({
        refspecs: ["+refs/heads/*:refs/remotes/peer/*"],
      });

      if (!fetchResult.ok) {
        throw new Error(fetchResult.error ?? "Fetch failed");
      }

      // Import the pack data into our repository
      if (fetchResult.packData.length > 0 && fetchResult.objectsReceived > 0) {
        logModel.info(
          `Received ${fetchResult.objectsReceived} objects (${fetchResult.bytesReceived} bytes)`,
        );

        // Import pack using serialization API
        const repository = getRepository(ctx);
        if (repository?.backend?.serialization) {
          // Wrap pack data as async iterable
          async function* packStream() {
            yield fetchResult.packData;
          }
          await repository.backend.serialization.importPack(packStream());
          logModel.info("Pack imported successfully");
        }

        // Update local refs from remote refs
        for (const refName of fetchResult.refsUpdated) {
          // Remote refs are mapped to refs/remotes/peer/*
          // For demo, also update local main if we fetched refs/remotes/peer/main
          if (refName === "refs/remotes/peer/main") {
            // Get the object ID from the fetched refs
            // The fetch result doesn't include the object IDs directly,
            // so we need to resolve from our refs
            const remoteRef = await repositoryAccess.getHead();
            if (remoteRef && "objectId" in remoteRef) {
              // For now, just log - the pack import should have updated refs
            }
          }
        }
      } else {
        logModel.info("No new objects to fetch (already up to date)");
      }

      // Update sync progress
      syncModel.updateProgress(fetchResult.objectsReceived, fetchResult.bytesReceived);

      // Now push our changes to the peer
      logModel.info("Pushing local changes to peer...");
      syncModel.update({ direction: "push", phase: "transferring" });

      const pushResult = await session.push({
        refspecs: ["refs/heads/main:refs/heads/main"],
      });

      if (!pushResult.ok && pushResult.error) {
        // Push failed, but fetch succeeded - log warning but don't fail
        logModel.warn(`Push failed: ${pushResult.error}`);
      } else if (pushResult.objectsSent > 0) {
        logModel.info(`Pushed ${pushResult.objectsSent} objects`);
      } else {
        logModel.info("No local changes to push");
      }

      // Mark complete
      syncModel.complete({
        objectsReceived: fetchResult.objectsReceived,
        objectsSent: pushResult.objectsSent,
        refsUpdated: [...fetchResult.refsUpdated, ...pushResult.refsUpdated],
      });

      peersModel.updatePeer(peerId, { lastSyncAt: new Date() });
      logModel.info(`Sync complete with ${displayName}`);

      // Clean up session
      await session.close();
      activeSessions.delete(peerId);

      // Reset after delay
      timerApi.setTimeout(() => {
        if (syncModel.getState().phase === "complete") {
          syncModel.reset();
        }
      }, COMPLETE_DISPLAY_MS);

      // Checkout HEAD to update working directory with synced files
      enqueueCheckoutAction(actionsModel);

      // Refresh repository state
      enqueueRefreshRepoAction(actionsModel);
    } catch (error) {
      const message = (error as Error).message;
      syncModel.fail(message);
      logModel.error(`Sync failed: ${message}`);

      // Clean up session on error
      const session = activeSessions.get(peerId);
      if (session) {
        await session.close();
        activeSessions.delete(peerId);
      }

      // Reset after delay
      timerApi.setTimeout(() => {
        if (syncModel.getState().phase === "error") {
          syncModel.reset();
        }
      }, COMPLETE_DISPLAY_MS);
    }
  }

  /**
   * Cancel ongoing sync.
   */
  async function handleSyncCancel(): Promise<void> {
    if (!syncModel.isActive) return;

    logModel.warn("Sync cancelled");

    // Close any active sessions
    for (const [peerId, session] of activeSessions) {
      await session.close();
      activeSessions.delete(peerId);
    }

    syncModel.reset();
  }

  // Clean up on unmount
  const originalCleanup = cleanup;
  return () => {
    // Clean up all Git servers
    for (const peerId of gitServers.keys()) {
      cleanupGitServer(peerId);
    }

    // Close all active sessions
    for (const session of activeSessions.values()) {
      session.close().catch(() => {});
    }
    activeSessions.clear();

    originalCleanup();
  };
}
