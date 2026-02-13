/**
 * Session controller - manages peer session lifecycle.
 *
 * Delegates connection management to IPeerConnectionProvider,
 * handling only user actions and model updates.
 */

import { listenDisconnectAction, listenJoinAction, listenShareAction } from "../actions/index.js";
import { buildShareUrl, generateQrCodeDataUrl } from "../lib/index.js";
import {
  getActivityLogModel,
  getPeersModel,
  getSessionModel,
  getUserActionsModel,
} from "../models/index.js";
import { newRegistry } from "../utils/index.js";
import type { AppContext } from "./index.js";
import { getConnectionProvider, getPeerConnections } from "./index.js";

export function createSessionController(ctx: AppContext): () => void {
  const [register, cleanup] = newRegistry();

  const sessionModel = getSessionModel(ctx);
  const peersModel = getPeersModel(ctx);
  const logModel = getActivityLogModel(ctx);
  const actionsModel = getUserActionsModel(ctx);
  const connections = getPeerConnections(ctx);
  const provider = getConnectionProvider(ctx);

  register(
    listenShareAction(actionsModel, () => {
      handleShare();
    }),
  );
  register(
    listenJoinAction(actionsModel, (actions) => {
      for (const { sessionId } of actions) handleJoin(sessionId);
    }),
  );
  register(
    listenDisconnectAction(actionsModel, () => {
      handleDisconnect();
    }),
  );

  async function handleShare(): Promise<void> {
    try {
      const sessionId = await provider.share({
        onConnection(peerId, port) {
          const displayName = truncateId(peerId);
          connections.set(peerId, port);
          peersModel.addPeer({
            id: peerId,
            displayName,
            status: "connected",
            isHost: false,
            lastSyncAt: null,
          });
          logModel.info(`Peer ${displayName} connected`);
        },
        onPeerDisconnected(peerId) {
          connections.delete(peerId);
          peersModel.removePeer(peerId);
          logModel.info(`Peer ${truncateId(peerId)} disconnected`);
        },
        onError(error) {
          logModel.error(`Connection error: ${error.message}`);
          sessionModel.setError(error.message);
        },
      });

      const shareUrl = buildShareUrl(sessionId);
      let qrCodeDataUrl: string | null = null;
      try {
        qrCodeDataUrl = await generateQrCodeDataUrl(shareUrl);
      } catch (e) {
        logModel.warn(`Failed to generate QR code: ${(e as Error).message}`);
      }

      sessionModel.update({
        mode: "hosting",
        sessionId,
        shareUrl,
        qrCodeDataUrl,
        error: null,
      });
      logModel.info(`Session created: ${sessionId}`);
    } catch (error) {
      const message = (error as Error).message;
      logModel.error(`Failed to create session: ${message}`);
      sessionModel.update({ mode: "disconnected", error: message });
    }
  }

  async function handleJoin(sessionId: string): Promise<void> {
    try {
      logModel.info(`Joining session: ${sessionId}`);
      const { port, peerId } = await provider.connect(sessionId);

      const displayName = truncateId(peerId);
      connections.set(peerId, port);
      peersModel.addPeer({
        id: peerId,
        displayName,
        status: "connected",
        isHost: true,
        lastSyncAt: null,
      });

      sessionModel.update({ mode: "joined", sessionId, error: null });
      logModel.info(`Connected to host ${displayName}`);
    } catch (error) {
      const message = (error as Error).message;
      logModel.error(`Failed to join session: ${message}`);
      sessionModel.update({ mode: "disconnected", error: message });
    }
  }

  function handleDisconnect(): void {
    logModel.info("Disconnecting...");
    provider.disconnect();
    connections.clear();
    peersModel.clear();
    sessionModel.reset();
    logModel.info("Disconnected");
  }

  return cleanup;
}

function truncateId(id: string, length = 8): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}
