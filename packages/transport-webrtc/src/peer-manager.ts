/**
 * WebRTC peer connection manager.
 *
 * Manages the lifecycle of a WebRTC peer connection for Git synchronization.
 * Handles signaling, ICE candidate gathering, and data channel creation.
 *
 * The peer manager supports both "initiator" (creates offer) and "responder"
 * (creates answer) roles for serverless signaling scenarios like QR codes.
 */

import type {
  ConnectionState,
  IceCandidate,
  PeerManagerEvents,
  PeerRole,
  SessionDescription,
  SignalingMessage,
  WebRtcConnectionOptions,
  WebRtcStats,
} from "./types.js";
import { DEFAULT_ICE_SERVERS } from "./types.js";

const DEFAULT_CONNECTION_TIMEOUT = 30000; // 30 seconds
const DEFAULT_ICE_GATHERING_TIMEOUT = 5000; // 5 seconds
const DEFAULT_CHANNEL_LABEL = "git-sync";

/**
 * Event listener types for the peer manager.
 */
type EventListener<K extends keyof PeerManagerEvents> = PeerManagerEvents[K];

/**
 * Manages a WebRTC peer connection lifecycle.
 *
 * Usage:
 * 1. Create manager with role (initiator/responder)
 * 2. Listen for 'signal' events and forward messages to peer
 * 3. Call handleSignal() with messages from peer
 * 4. Wait for 'open' event to get the data channel
 *
 * @example Initiator side:
 * ```typescript
 * const manager = new PeerManager("initiator");
 * manager.on("signal", (msg) => sendToPeer(msg));
 * manager.on("open", () => console.log("Connected!"));
 * await manager.connect();
 * ```
 *
 * @example Responder side:
 * ```typescript
 * const manager = new PeerManager("responder");
 * manager.on("signal", (msg) => sendToPeer(msg));
 * manager.on("open", () => console.log("Connected!"));
 * await manager.handleSignal(offerFromInitiator);
 * ```
 */
export class PeerManager {
  private readonly role: PeerRole;
  private readonly options: WebRtcConnectionOptions;
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private state: ConnectionState = "new";
  private startTime = 0;
  private candidatesGathered = 0;

  // Event listeners
  private readonly listeners: Map<
    keyof PeerManagerEvents,
    Set<EventListener<keyof PeerManagerEvents>>
  > = new Map();

  // ICE candidates gathered before remote description is set
  private pendingCandidates: RTCIceCandidate[] = [];
  private remoteDescriptionSet = false;

  // Collected ICE candidates for batch signaling (QR code mode)
  private collectedCandidates: IceCandidate[] = [];
  private iceGatheringComplete = false;

  constructor(role: PeerRole, options: WebRtcConnectionOptions = {}) {
    this.role = role;
    this.options = options;
  }

  /**
   * Get the current connection state.
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get the peer role.
   */
  getRole(): PeerRole {
    return this.role;
  }

  /**
   * Get the data channel (available after 'open' event).
   */
  getDataChannel(): RTCDataChannel | null {
    return this.dataChannel;
  }

  /**
   * Subscribe to an event.
   */
  on<K extends keyof PeerManagerEvents>(event: K, listener: PeerManagerEvents[K]): this {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener as EventListener<keyof PeerManagerEvents>);
    return this;
  }

  /**
   * Unsubscribe from an event.
   */
  off<K extends keyof PeerManagerEvents>(event: K, listener: PeerManagerEvents[K]): this {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(listener as EventListener<keyof PeerManagerEvents>);
    }
    return this;
  }

  /**
   * Emit an event.
   */
  private emit<K extends keyof PeerManagerEvents>(
    event: K,
    ...args: Parameters<PeerManagerEvents[K]>
  ): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        (listener as (...args: Parameters<PeerManagerEvents[K]>) => void)(...args);
      }
    }
  }

  /**
   * Initialize the peer connection.
   */
  private initConnection(): RTCPeerConnection {
    if (this.pc) {
      return this.pc;
    }

    this.startTime = Date.now();
    this.setState("connecting");

    const iceServers = this.options.iceServers ?? DEFAULT_ICE_SERVERS;
    this.pc = new RTCPeerConnection({ iceServers });

    // Track ICE gathering
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.candidatesGathered++;

        // Collect for batch signaling
        this.collectedCandidates.push({
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        });

        // Emit individual candidate for trickle ICE
        this.emit("signal", {
          type: "candidate",
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          },
        });
      }
    };

    this.pc.onicegatheringstatechange = () => {
      if (this.pc?.iceGatheringState === "complete") {
        this.iceGatheringComplete = true;
        this.emit("signal", { type: "ready" });
      }
    };

    // Track connection state
    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      switch (state) {
        case "connected":
          this.setState("connected");
          break;
        case "disconnected":
          this.setState("disconnected");
          break;
        case "failed":
          this.setState("failed");
          this.emit("error", new Error("Connection failed"));
          break;
        case "closed":
          this.setState("closed");
          break;
      }
    };

    // Handle incoming data channel (responder side)
    this.pc.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel();
    };

    return this.pc;
  }

  /**
   * Set up data channel event handlers.
   */
  private setupDataChannel(): void {
    if (!this.dataChannel) return;

    this.dataChannel.binaryType = "arraybuffer";

    this.dataChannel.onopen = () => {
      this.emit("open");
    };

    this.dataChannel.onclose = () => {
      this.emit("close");
    };

    this.dataChannel.onerror = (event) => {
      const errorEvent = event as RTCErrorEvent;
      this.emit("error", errorEvent.error ?? new Error("DataChannel error"));
    };
  }

  /**
   * Update connection state.
   */
  private setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit("stateChange", newState);
    }
  }

  /**
   * Start connection as initiator.
   *
   * Creates an offer and emits it via 'signal' event.
   * The caller should forward the offer to the responder.
   */
  async connect(): Promise<void> {
    if (this.role !== "initiator") {
      throw new Error("connect() should only be called by initiator");
    }

    const pc = this.initConnection();

    // Create data channel (initiator creates it)
    const label = this.options.channelLabel ?? DEFAULT_CHANNEL_LABEL;
    this.dataChannel = pc.createDataChannel(label, {
      ordered: this.options.ordered ?? true,
      maxRetransmits: this.options.maxRetransmits,
    });
    this.setupDataChannel();

    // Create and set local description
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Emit offer
    if (offer.sdp) {
      this.emit("signal", {
        type: "offer",
        sdp: offer.sdp,
      });
    }
  }

  /**
   * Handle a signaling message from the remote peer.
   */
  async handleSignal(message: SignalingMessage): Promise<void> {
    const pc = this.initConnection();

    switch (message.type) {
      case "offer":
        await this.handleOffer(pc, message.sdp);
        break;

      case "answer":
        await this.handleAnswer(pc, message.sdp);
        break;

      case "candidate":
        await this.handleCandidate(pc, message.candidate);
        break;

      case "ready":
        // Remote peer finished gathering ICE candidates
        break;
    }
  }

  /**
   * Handle offer from initiator (responder side).
   */
  private async handleOffer(pc: RTCPeerConnection, sdp: string): Promise<void> {
    if (this.role !== "responder") {
      throw new Error("Received offer but not in responder role");
    }

    // Set remote description
    await pc.setRemoteDescription({ type: "offer", sdp });
    this.remoteDescriptionSet = true;

    // Process any pending candidates
    await this.processPendingCandidates(pc);

    // Create answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Emit answer
    if (answer.sdp) {
      this.emit("signal", {
        type: "answer",
        sdp: answer.sdp,
      });
    }
  }

  /**
   * Handle answer from responder (initiator side).
   */
  private async handleAnswer(pc: RTCPeerConnection, sdp: string): Promise<void> {
    if (this.role !== "initiator") {
      throw new Error("Received answer but not in initiator role");
    }

    await pc.setRemoteDescription({ type: "answer", sdp });
    this.remoteDescriptionSet = true;

    // Process any pending candidates
    await this.processPendingCandidates(pc);
  }

  /**
   * Handle ICE candidate from remote peer.
   */
  private async handleCandidate(pc: RTCPeerConnection, candidate: IceCandidate): Promise<void> {
    const rtcCandidate = new RTCIceCandidate({
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
    });

    if (this.remoteDescriptionSet) {
      await pc.addIceCandidate(rtcCandidate);
    } else {
      // Queue until remote description is set
      this.pendingCandidates.push(rtcCandidate);
    }
  }

  /**
   * Process pending ICE candidates.
   */
  private async processPendingCandidates(pc: RTCPeerConnection): Promise<void> {
    for (const candidate of this.pendingCandidates) {
      await pc.addIceCandidate(candidate);
    }
    this.pendingCandidates = [];
  }

  /**
   * Wait for ICE gathering to complete.
   *
   * Useful for batch signaling (QR codes) where all candidates
   * need to be collected before exchanging signals.
   */
  async waitForIceGathering(): Promise<void> {
    if (this.iceGatheringComplete) {
      return;
    }

    const timeout = this.options.iceGatheringTimeout ?? DEFAULT_ICE_GATHERING_TIMEOUT;

    return new Promise((resolve) => {
      const checkComplete = () => {
        if (this.iceGatheringComplete) {
          resolve();
        }
      };

      // Check periodically
      const interval = setInterval(checkComplete, 100);

      // Also listen for the event
      const handler = () => {
        clearInterval(interval);
        clearTimeout(timer);
        resolve();
      };

      this.on("signal", (msg) => {
        if (msg.type === "ready") {
          handler();
        }
      });

      // Timeout fallback
      const timer = setTimeout(() => {
        clearInterval(interval);
        resolve(); // Resolve anyway - we'll use what we have
      }, timeout);
    });
  }

  /**
   * Get the local session description after ICE gathering.
   */
  getLocalDescription(): SessionDescription | null {
    if (!this.pc?.localDescription) {
      return null;
    }
    return {
      type: this.pc.localDescription.type as "offer" | "answer",
      sdp: this.pc.localDescription.sdp,
    };
  }

  /**
   * Get collected ICE candidates.
   */
  getCollectedCandidates(): IceCandidate[] {
    return [...this.collectedCandidates];
  }

  /**
   * Get connection statistics.
   */
  async getStats(): Promise<WebRtcStats> {
    let bytesSent = 0;
    let bytesReceived = 0;
    let roundTripTimeMs: number | undefined;

    if (this.pc) {
      const stats = await this.pc.getStats();
      stats.forEach((report) => {
        if (report.type === "data-channel") {
          bytesSent += report.bytesSent || 0;
          bytesReceived += report.bytesReceived || 0;
        }
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          roundTripTimeMs = report.currentRoundTripTime
            ? report.currentRoundTripTime * 1000
            : undefined;
        }
      });
    }

    return {
      bytesSent,
      bytesReceived,
      roundTripTimeMs,
      connectionDurationMs: this.startTime ? Date.now() - this.startTime : 0,
      candidatesGathered: this.candidatesGathered,
    };
  }

  /**
   * Close the connection and release resources.
   */
  close(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    this.setState("closed");
    this.listeners.clear();
  }
}

/**
 * Wait for both peers to connect with timeout.
 *
 * @param manager The peer manager
 * @param timeout Connection timeout in milliseconds
 * @returns Promise that resolves when connected
 */
export function waitForConnection(manager: PeerManager, timeout?: number): Promise<RTCDataChannel> {
  const connectionTimeout = timeout ?? DEFAULT_CONNECTION_TIMEOUT;

  return new Promise((resolve, reject) => {
    const channel = manager.getDataChannel();

    // Already open?
    if (channel?.readyState === "open") {
      resolve(channel);
      return;
    }

    const cleanup = () => {
      manager.off("open", onOpen);
      manager.off("error", onError);
      clearTimeout(timer);
    };

    const onOpen = () => {
      cleanup();
      const ch = manager.getDataChannel();
      if (ch) {
        resolve(ch);
      } else {
        reject(new Error("No data channel after open"));
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    manager.on("open", onOpen);
    manager.on("error", onError);

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Connection timeout after ${connectionTimeout}ms`));
    }, connectionTimeout);
  });
}
