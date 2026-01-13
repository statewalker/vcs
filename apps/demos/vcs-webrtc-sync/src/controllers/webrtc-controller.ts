/**
 * WebRTC Controller
 *
 * Manages WebRTC peer-to-peer connections for repository synchronization.
 * Uses PeerManager and QrSignaling from vcs-transport-webrtc.
 */

import type { TransportConnection } from "@statewalker/vcs-transport";
import {
  createWebRtcStream,
  PeerManager,
  QrSignaling,
  type SignalingMessage,
} from "@statewalker/vcs-transport-webrtc";
import { getActivityLogModel, getConnectionModel, getSharingFormModel } from "../models/index.js";
import { newAdapter, newRegistry } from "../utils/index.js";

// Adapters for WebRTC state
export const [getPeerManager, setPeerManager] = newAdapter<PeerManager | null>(
  "peer-manager",
  () => null,
);

export const [getSignaling, setSignaling] = newAdapter<QrSignaling | null>(
  "qr-signaling",
  () => null,
);

export const [getDataChannel, setDataChannel] = newAdapter<RTCDataChannel | null>(
  "data-channel",
  () => null,
);

export const [getTransport, setTransport] = newAdapter<TransportConnection | null>(
  "transport-connection",
  () => null,
);

/**
 * Create the WebRTC controller.
 * Returns cleanup function.
 */
export function createWebRtcController(ctx: Map<string, unknown>): () => void {
  const [register, cleanup] = newRegistry();

  register(() => {
    const peer = getPeerManager(ctx);
    if (peer) {
      peer.close();
      setPeerManager(ctx, null);
      setSignaling(ctx, null);
      setDataChannel(ctx, null);
      setTransport(ctx, null);
    }
  });

  return cleanup;
}

/**
 * Create an offer to initiate a P2P connection.
 * Returns the signaling payload to share with the peer.
 */
export async function createOffer(ctx: Map<string, unknown>): Promise<string | null> {
  const connectionModel = getConnectionModel(ctx);
  const sharingModel = getSharingFormModel(ctx);
  const logModel = getActivityLogModel(ctx);

  // Close any existing connection
  const existingPeer = getPeerManager(ctx);
  if (existingPeer) {
    existingPeer.close();
  }

  sharingModel.startShare();
  connectionModel.setConnecting("initiator");

  try {
    const signaling = new QrSignaling();
    const peer = new PeerManager("initiator");

    setSignaling(ctx, signaling);
    setPeerManager(ctx, peer);

    // Collect signals
    const signals: SignalingMessage[] = [];
    peer.on("signal", (msg) => signals.push(msg));

    // Handle state changes
    peer.on("stateChange", (state) => {
      logModel.info(`Connection state: ${state}`);
      if (state === "connected") {
        connectionModel.setConnected();
      } else if (state === "failed" || state === "closed") {
        connectionModel.setDisconnected();
      }
    });

    // Handle data channel open
    peer.on("open", () => {
      logModel.success("Data channel opened!");
      const channel = peer.getDataChannel();
      if (channel) {
        setDataChannel(ctx, channel);
        const transport = createWebRtcStream(channel);
        setTransport(ctx, transport);
      }
    });

    peer.on("error", (err) => {
      logModel.error(`WebRTC error: ${err.message}`);
      connectionModel.setFailed(err.message);
    });

    // Start connection
    logModel.info("Creating offer...");
    await peer.connect();

    // Wait for ICE gathering
    logModel.info("Gathering ICE candidates...");
    await peer.waitForIceGathering();

    // Create compact signal payload
    const description = peer.getLocalDescription();
    if (!description) {
      throw new Error("Failed to get local description");
    }
    const candidates = peer.getCollectedCandidates();
    const payload = signaling.createPayload("initiator", description, candidates);

    sharingModel.setLocalSignal(payload);
    logModel.info(`Offer created (${payload.length} chars)`);

    return payload;
  } catch (error) {
    logModel.error(`Failed to create offer: ${(error as Error).message}`);
    connectionModel.setFailed((error as Error).message);
    sharingModel.reset();
    return null;
  }
}

/**
 * Accept an offer from a peer and create an answer.
 * Returns the answer payload to share back.
 */
export async function acceptOffer(
  ctx: Map<string, unknown>,
  offerPayload: string,
): Promise<string | null> {
  const connectionModel = getConnectionModel(ctx);
  const sharingModel = getSharingFormModel(ctx);
  const logModel = getActivityLogModel(ctx);

  // Close any existing connection
  const existingPeer = getPeerManager(ctx);
  if (existingPeer) {
    existingPeer.close();
  }

  connectionModel.setConnecting("responder");

  try {
    const signaling = new QrSignaling();
    const { description, candidates } = signaling.parsePayload(offerPayload);

    const peer = new PeerManager("responder");

    setSignaling(ctx, signaling);
    setPeerManager(ctx, peer);

    // Collect signals
    const signals: SignalingMessage[] = [];
    peer.on("signal", (msg) => signals.push(msg));

    // Handle state changes
    peer.on("stateChange", (state) => {
      logModel.info(`Connection state: ${state}`);
      if (state === "connected") {
        connectionModel.setConnected();
      } else if (state === "failed" || state === "closed") {
        connectionModel.setDisconnected();
      }
    });

    // Handle data channel open
    peer.on("open", () => {
      logModel.success("Data channel opened!");
      const channel = peer.getDataChannel();
      if (channel) {
        setDataChannel(ctx, channel);
        const transport = createWebRtcStream(channel);
        setTransport(ctx, transport);
      }
    });

    peer.on("error", (err) => {
      logModel.error(`WebRTC error: ${err.message}`);
      connectionModel.setFailed(err.message);
    });

    // Handle the offer
    logModel.info("Processing offer...");
    await peer.handleSignal({ type: "offer", sdp: description.sdp });

    // Add ICE candidates
    for (const candidate of candidates) {
      await peer.handleSignal({ type: "candidate", candidate });
    }

    // Wait for ICE gathering
    logModel.info("Gathering ICE candidates...");
    await peer.waitForIceGathering();

    // Create answer
    const answerDescription = peer.getLocalDescription();
    if (!answerDescription) {
      throw new Error("Failed to get local description");
    }
    const answerCandidates = peer.getCollectedCandidates();
    const answerPayload = signaling.createPayload("responder", answerDescription, answerCandidates);

    sharingModel.setLocalSignal(answerPayload);
    logModel.info(`Answer created (${answerPayload.length} chars)`);

    return answerPayload;
  } catch (error) {
    logModel.error(`Failed to accept offer: ${(error as Error).message}`);
    connectionModel.setFailed((error as Error).message);
    sharingModel.reset();
    return null;
  }
}

/**
 * Accept an answer from a peer to complete the connection.
 */
export async function acceptAnswer(
  ctx: Map<string, unknown>,
  answerPayload: string,
): Promise<boolean> {
  const peer = getPeerManager(ctx);
  const signaling = getSignaling(ctx);
  const connectionModel = getConnectionModel(ctx);
  const sharingModel = getSharingFormModel(ctx);
  const logModel = getActivityLogModel(ctx);

  if (!peer || !signaling) {
    logModel.error("No pending connection");
    return false;
  }

  try {
    const { description, candidates } = signaling.parsePayload(answerPayload);

    logModel.info("Processing answer...");

    // Handle the answer
    await peer.handleSignal({ type: "answer", sdp: description.sdp });

    // Add ICE candidates
    for (const candidate of candidates) {
      await peer.handleSignal({ type: "candidate", candidate });
    }

    logModel.info("Answer accepted, waiting for connection...");
    sharingModel.reset();

    return true;
  } catch (error) {
    logModel.error(`Failed to accept answer: ${(error as Error).message}`);
    connectionModel.setFailed((error as Error).message);
    return false;
  }
}

/**
 * Close the current WebRTC connection.
 */
export function closeConnection(ctx: Map<string, unknown>): void {
  const peer = getPeerManager(ctx);
  const connectionModel = getConnectionModel(ctx);
  const sharingModel = getSharingFormModel(ctx);
  const logModel = getActivityLogModel(ctx);

  if (peer) {
    peer.close();
    setPeerManager(ctx, null);
    setSignaling(ctx, null);
    setDataChannel(ctx, null);
    setTransport(ctx, null);
  }

  connectionModel.reset();
  sharingModel.reset();
  logModel.info("Connection closed");
}

/**
 * Get the current transport connection for sync operations.
 */
export function getTransportConnection(ctx: Map<string, unknown>): TransportConnection | null {
  return getTransport(ctx);
}

/**
 * Check if a peer connection is established and ready.
 */
export function isConnected(ctx: Map<string, unknown>): boolean {
  const connectionModel = getConnectionModel(ctx);
  return connectionModel.isConnected;
}
