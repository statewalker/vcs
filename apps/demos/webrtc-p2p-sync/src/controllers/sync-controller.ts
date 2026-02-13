/**
 * Sync controller - orchestrates Git synchronization over WebRTC.
 *
 * Uses the new transport Duplex API (fetchOverDuplex/pushOverDuplex/serveOverDuplex)
 * for efficient sync:
 * - Only transfers missing objects (proper negotiation)
 * - Uses packfile format (delta compression)
 * - Standard Git protocol (interoperable)
 *
 * Flow:
 * 1. Host sets up Git server on each incoming connection
 * 2. When user clicks sync, client performs fetch then push
 * 3. Pack data is imported automatically by the transport layer
 * 4. Local refs are updated automatically by the transport layer
 */

import {
  enqueueCheckoutAction,
  enqueueRefreshRepoAction,
  listenCancelSyncAction,
  listenStartSyncAction,
} from "../actions/index.js";
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
import { getHistory, getSerializationApi } from "./index.js";

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

  // Set up Git servers for ALL connected peers.
  // Both host and guest need servers: the host serves guests' sync requests,
  // and the guest must also serve when the host initiates sync.
  register(
    peersModel.onUpdate(() => {
      const history = getHistory(ctx);
      const serialization = getSerializationApi(ctx);
      if (!history || !serialization) return;

      // Set up servers for all connected peers
      for (const [peerId, port] of connections) {
        const peer = peersModel.get(peerId);
        if (peer) {
          setupGitServerForPeer(peerId, port);
        }
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
  function setupGitServerForPeer(peerId: string, port: MessagePort): void {
    if (gitServers.has(peerId)) return;

    const history = getHistory(ctx);
    const serialization = getSerializationApi(ctx);
    if (!history || !serialization) return;

    const displayName = peersModel.get(peerId)?.displayName ?? peerId;
    logModel.info(`Setting up Git server for ${displayName}`);

    try {
      const cleanup = setupGitPeerServer({
        port,
        history,
        serialization,
        logger: {
          debug: (...args) => logModel.info(`[Git Server] ${args.join(" ")}`),
          error: (...args) => logModel.error(`[Git Server] ${args.join(" ")}`),
        },
        onPushReceived: () => {
          logModel.info(`Received push from ${displayName}, updating working directory...`);
          enqueueCheckoutAction(actionsModel);
          enqueueRefreshRepoAction(actionsModel);
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
   * Start sync with a peer (fetch their data, then push ours).
   */
  async function handleSyncStart(peerId: string): Promise<void> {
    // Don't start if already syncing
    if (syncModel.isActive) {
      logModel.warn("Sync already in progress");
      return;
    }

    // Get the peer's MessagePort
    const port = connections.get(peerId);
    if (!port) {
      logModel.error(`Peer ${peerId} not connected`);
      return;
    }

    // Get repository history and serialization
    const history = getHistory(ctx);
    const serialization = getSerializationApi(ctx);
    if (!history || !serialization) {
      logModel.error("Repository not initialized");
      return;
    }

    const displayName = peersModel.get(peerId)?.displayName ?? peerId;
    logModel.info(`Starting sync with ${displayName}...`);

    // Start sync (discovering phase)
    syncModel.startSync(peerId, "fetch");

    try {
      // Create Git peer session
      const session = createGitPeerSession({
        port,
        history,
        serialization,
        onProgress: (phase, message) => {
          logModel.info(`[Sync] ${phase}: ${message}`);
          if (phase === "transferring") {
            syncModel.update({ phase: "transferring" });
          }
        },
      });

      activeSessions.set(peerId, session);

      // Save local main ref before fetch (fetchOverDuplex overwrites all server-advertised refs)
      const localMainBefore = (await history.refs.resolve("refs/heads/main"))?.objectId ?? null;

      // Perform fetch
      // The transport layer handles pack import and ref updates automatically
      syncModel.setDiscoveryComplete(0);

      const fetchResult = await session.fetch({
        refspecs: ["+refs/heads/*:refs/remotes/peer/*"],
      });

      if (!fetchResult.ok) {
        throw new Error(fetchResult.error ?? "Fetch failed");
      }

      logModel.info(
        `Fetched ${fetchResult.objectsReceived} objects, ${fetchResult.refs.size} refs updated`,
      );

      // fetchOverDuplex writes ALL server-advertised refs to local refStore,
      // which may overwrite HEAD (from symbolic to direct) and refs/heads/main.
      // Restore HEAD as symbolic ref so future commits update refs/heads/main.
      await history.refs.setSymbolic("HEAD", "refs/heads/main");

      // Remap server refs to remote tracking refs (refs/remotes/peer/*)
      let remotePeerMain: string | null = null;
      for (const [refName, objectId] of fetchResult.refs) {
        if (refName.startsWith("refs/heads/")) {
          const remoteName = refName.replace("refs/heads/", "refs/remotes/peer/");
          await history.refs.set(remoteName, objectId);
          logModel.info(`Updated ref ${remoteName} -> ${objectId.slice(0, 7)}`);

          if (remoteName === "refs/remotes/peer/main") {
            remotePeerMain = objectId;
          }
        }
      }

      // Restore local refs/heads/main:
      // - If we had local commits, keep them (so push sends them to the peer)
      // - If this is the first sync (no local main), accept the remote value
      if (localMainBefore) {
        await history.refs.set("refs/heads/main", localMainBefore);
        logModel.info(`Restored local main -> ${localMainBefore.slice(0, 7)}`);
      } else if (remotePeerMain) {
        await history.refs.set("refs/heads/main", remotePeerMain);
        logModel.info(`Set local main -> ${remotePeerMain.slice(0, 7)}`);
      }

      // Update sync progress
      syncModel.updateProgress(fetchResult.objectsReceived, 0);

      // Now push our changes to the peer
      logModel.info("Pushing local changes to peer...");
      syncModel.update({ direction: "push", phase: "transferring" });

      const pushResult = await session.push({
        refspecs: ["refs/heads/main:refs/heads/main"],
      });

      if (!pushResult.ok && pushResult.error) {
        logModel.warn(`Push failed: ${pushResult.error}`);
      } else {
        logModel.info("Push complete");
      }

      // Mark complete
      syncModel.complete({
        objectsReceived: fetchResult.objectsReceived,
        objectsSent: 0,
        refsUpdated: [...fetchResult.refs.keys()],
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

// Re-import for internal use (avoid circular dependency)
import { getPeerConnections } from "./index.js";
