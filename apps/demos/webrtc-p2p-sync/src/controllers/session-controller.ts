/**
 * Session controller - manages PeerJS session lifecycle.
 *
 * Handles:
 * - Starting a sharing session (hosting)
 * - Joining an existing session
 * - Managing peer connections
 * - Disconnecting and cleanup
 */

import {
  getPeerJsApi,
  getTimerApi,
  type PeerConnection,
  type PeerInstance,
} from "../apis/index.js";
import { buildShareUrl, generateQrCodeDataUrl, generateSessionId } from "../lib/index.js";
import {
  getActivityLogModel,
  getPeersModel,
  getSessionModel,
  getUserActionsModel,
} from "../models/index.js";
import { newRegistry } from "../utils/index.js";
import type { AppContext } from "./index.js";
import { getPeerConnections, getPeerInstance, setPeerInstance } from "./index.js";

/**
 * Create the session controller.
 *
 * @param ctx The application context
 * @returns Cleanup function
 */
export function createSessionController(ctx: AppContext): () => void {
  const [register, cleanup] = newRegistry();

  // Get models
  const sessionModel = getSessionModel(ctx);
  const peersModel = getPeersModel(ctx);
  const logModel = getActivityLogModel(ctx);
  const actionsModel = getUserActionsModel(ctx);

  // Get APIs
  const peerJsApi = getPeerJsApi(ctx);
  const timerApi = getTimerApi(ctx);

  // Get connection storage
  const connections = getPeerConnections(ctx);

  // Listen to user actions
  register(
    actionsModel.onUpdate(() => {
      // Handle share request
      for (const _action of actionsModel.consume("connection:share")) {
        handleShare();
      }

      // Handle join request
      for (const action of actionsModel.consume("connection:join")) {
        const { sessionId } = action.payload as { sessionId: string };
        handleJoin(sessionId);
      }

      // Handle disconnect request
      for (const _action of actionsModel.consume("connection:disconnect")) {
        handleDisconnect();
      }
    }),
  );

  /**
   * Start hosting a session.
   */
  async function handleShare(): Promise<void> {
    try {
      const sessionId = generateSessionId();
      logModel.info(`Creating session: ${sessionId}`);

      // Create PeerJS peer with session ID
      const peer = peerJsApi.createPeer(sessionId);
      setPeerInstance(ctx, peer);

      // Handle peer open event
      peer.on("open", async (id: string) => {
        const shareUrl = buildShareUrl(id);
        let qrCodeDataUrl: string | null = null;

        try {
          qrCodeDataUrl = await generateQrCodeDataUrl(shareUrl);
        } catch (e) {
          logModel.warn(`Failed to generate QR code: ${(e as Error).message}`);
        }

        sessionModel.update({
          mode: "hosting",
          sessionId: id,
          shareUrl,
          qrCodeDataUrl,
          error: null,
        });

        logModel.info(`Session created: ${id}`);
      });

      // Handle incoming connections
      peer.on("connection", (conn: PeerConnection) => {
        handleIncomingConnection(peer, conn);
      });

      // Handle errors
      peer.on("error", (err: Error) => {
        logModel.error(`PeerJS error: ${err.message}`);
        sessionModel.setError(err.message);
      });

      // Handle disconnection from server
      peer.on("disconnected", () => {
        logModel.warn("Disconnected from signaling server");
      });

      // Handle peer close
      peer.on("close", () => {
        logModel.info("Peer destroyed");
      });
    } catch (error) {
      const message = (error as Error).message;
      logModel.error(`Failed to create session: ${message}`);
      sessionModel.update({ mode: "disconnected", error: message });
    }
  }

  /**
   * Join an existing session.
   */
  async function handleJoin(sessionId: string): Promise<void> {
    try {
      logModel.info(`Joining session: ${sessionId}`);

      // Create PeerJS peer (random ID for joiner)
      const peer = peerJsApi.createPeer();
      setPeerInstance(ctx, peer);

      // Wait for peer to be ready
      peer.on("open", () => {
        logModel.info(`Peer ready, connecting to host...`);

        // Connect to host
        const conn = peer.connect(sessionId, {
          serialization: "raw",
          reliable: true,
        });

        handleOutgoingConnection(peer, conn, sessionId);
      });

      // Handle errors
      peer.on("error", (err: Error) => {
        logModel.error(`PeerJS error: ${err.message}`);
        sessionModel.update({ mode: "disconnected", error: err.message });
      });

      // Handle peer close
      peer.on("close", () => {
        logModel.info("Peer destroyed");
      });

      // Update session state
      sessionModel.update({
        mode: "joined",
        sessionId,
        error: null,
      });
    } catch (error) {
      const message = (error as Error).message;
      logModel.error(`Failed to join session: ${message}`);
      sessionModel.update({ mode: "disconnected", error: message });
    }
  }

  /**
   * Handle an incoming connection (we're the host).
   */
  function handleIncomingConnection(_peer: PeerInstance, conn: PeerConnection): void {
    const peerId = conn.peer;
    const displayName = truncateId(peerId);

    logModel.info(`Incoming connection from ${displayName}...`);

    // Add peer to model (connecting status)
    peersModel.addPeer({
      id: peerId,
      displayName,
      status: "connecting",
      isHost: false,
      lastSyncAt: null,
    });

    // Handle connection open
    conn.on("open", () => {
      connections.set(peerId, conn);
      peersModel.updatePeer(peerId, { status: "connected" });
      logModel.info(`Peer ${displayName} connected`);
    });

    // Handle connection close
    conn.on("close", () => {
      connections.delete(peerId);
      peersModel.removePeer(peerId);
      logModel.info(`Peer ${displayName} disconnected`);
    });

    // Handle errors
    conn.on("error", (err: Error) => {
      logModel.error(`Connection error with ${displayName}: ${err.message}`);
      peersModel.updatePeer(peerId, { status: "disconnected" });
    });
  }

  /**
   * Handle an outgoing connection (we're the joiner).
   */
  function handleOutgoingConnection(
    _peer: PeerInstance,
    conn: PeerConnection,
    hostId: string,
  ): void {
    const displayName = truncateId(hostId);

    // Add host to peers model (connecting status)
    peersModel.addPeer({
      id: hostId,
      displayName,
      status: "connecting",
      isHost: true,
      lastSyncAt: null,
    });

    // Handle connection open
    conn.on("open", () => {
      connections.set(hostId, conn);
      peersModel.updatePeer(hostId, { status: "connected" });
      logModel.info(`Connected to host ${displayName}`);
    });

    // Handle connection close
    conn.on("close", () => {
      connections.delete(hostId);
      peersModel.removePeer(hostId);
      logModel.info(`Disconnected from host ${displayName}`);

      // If we lose connection to host, go back to disconnected state
      timerApi.setTimeout(() => {
        if (sessionModel.getState().mode === "joined" && peersModel.count === 0) {
          sessionModel.setMode("disconnected");
        }
      }, 100);
    });

    // Handle errors
    conn.on("error", (err: Error) => {
      logModel.error(`Connection error with host: ${err.message}`);
      peersModel.updatePeer(hostId, { status: "disconnected" });
    });
  }

  /**
   * Disconnect from the session.
   */
  function handleDisconnect(): void {
    logModel.info("Disconnecting...");

    // Get and destroy the peer instance
    const peer = getPeerInstance(ctx);
    if (peer) {
      peer.destroy();
      setPeerInstance(ctx, null);
    }

    // Clear all connections
    connections.clear();

    // Clear peers
    peersModel.clear();

    // Reset session state
    sessionModel.reset();

    logModel.info("Disconnected");
  }

  return cleanup;
}

/**
 * Truncate a peer ID for display.
 */
function truncateId(id: string, length = 8): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}
