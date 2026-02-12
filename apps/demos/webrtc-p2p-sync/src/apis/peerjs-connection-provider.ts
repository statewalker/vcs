/**
 * PeerJS-backed IPeerConnectionProvider implementation.
 *
 * Wraps all PeerJS-specific logic (peer creation, event handling, ICE monitoring)
 * and exposes MessagePort-based connections via the IPeerConnectionProvider interface.
 */

import { generateSessionId } from "../lib/index.js";
import type {
  IPeerConnectionProvider,
  PeerConnectionCallbacks,
  PeerConnectionResult,
  SessionId,
} from "./peer-connection-provider.js";
import type { PeerConnection, PeerInstance, PeerJsApi } from "./peerjs-api.js";

export class PeerJsConnectionProvider implements IPeerConnectionProvider {
  private peerJsApi: PeerJsApi;
  private peer: PeerInstance | null = null;
  private bridges = new Map<string, { channel: MessageChannel; conn: PeerConnection }>();

  constructor(peerJsApi: PeerJsApi) {
    this.peerJsApi = peerJsApi;
  }

  async share(callbacks: PeerConnectionCallbacks): Promise<SessionId> {
    const sessionId = generateSessionId();
    this.peer = this.peerJsApi.createPeer(sessionId);
    const peer = this.peer;

    return new Promise<SessionId>((resolve, reject) => {
      peer.on("open", (id: string) => {
        resolve(id);
      });

      peer.on("connection", (conn: PeerConnection) => {
        conn.on("open", () => {
          const channel = new MessageChannel();
          this.bridgeConnection(conn, channel);
          this.bridges.set(conn.peer, { channel, conn });
          callbacks.onConnection(conn.peer, channel.port2);
        });

        // Monitor ICE connection state for faster disconnection detection
        const rtcConn = (conn as unknown as { peerConnection?: RTCPeerConnection }).peerConnection;
        if (rtcConn) {
          rtcConn.addEventListener("iceconnectionstatechange", () => {
            const state = rtcConn.iceConnectionState;
            if (state === "disconnected" || state === "failed" || state === "closed") {
              this.removeBridge(conn.peer);
              callbacks.onPeerDisconnected?.(conn.peer);
            }
          });
        }

        conn.on("close", () => {
          this.removeBridge(conn.peer);
          callbacks.onPeerDisconnected?.(conn.peer);
        });

        conn.on("error", () => {
          this.removeBridge(conn.peer);
          callbacks.onPeerDisconnected?.(conn.peer);
        });
      });

      peer.on("error", (err: Error) => {
        callbacks.onError?.(err);
        // Reject only if we haven't resolved yet (peer failed to open)
        reject(err);
      });

      peer.on("disconnected", () => {
        // Signaling server disconnected — PeerJS handles reconnection
      });
    });
  }

  async connect(sessionId: SessionId): Promise<PeerConnectionResult> {
    this.peer = this.peerJsApi.createPeer();
    const peer = this.peer;

    return new Promise<PeerConnectionResult>((resolve, reject) => {
      peer.on("open", () => {
        const conn = peer.connect(sessionId, {
          serialization: "raw",
          reliable: true,
        });

        conn.on("open", () => {
          const channel = new MessageChannel();
          this.bridgeConnection(conn, channel);
          this.bridges.set(sessionId, { channel, conn });
          resolve({ port: channel.port2, peerId: sessionId });
        });

        conn.on("error", (err: Error) => {
          reject(err);
        });
      });

      peer.on("error", (err: Error) => {
        reject(err);
      });
    });
  }

  disconnect(): void {
    // Close all bridges
    for (const [, bridge] of this.bridges) {
      bridge.channel.port1.close();
      bridge.channel.port2.close();
      bridge.conn.close();
    }
    this.bridges.clear();

    // Destroy the peer
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }

  private bridgeConnection(conn: PeerConnection, channel: MessageChannel): void {
    // PeerJS → MessagePort
    conn.on("data", (data: unknown) => {
      const bytes =
        data instanceof Uint8Array
          ? data
          : data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data as ArrayBuffer);
      channel.port1.postMessage(bytes);
    });

    // MessagePort → PeerJS
    channel.port1.addEventListener("message", (event) => {
      conn.send(event.data);
    });
    channel.port1.start();
  }

  private removeBridge(peerId: string): void {
    const bridge = this.bridges.get(peerId);
    if (bridge) {
      bridge.channel.port1.close();
      bridge.channel.port2.close();
      this.bridges.delete(peerId);
    }
  }
}
