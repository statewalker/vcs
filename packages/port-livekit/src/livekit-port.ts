/**
 * LiveKit Room adapter returning standard MessagePort.
 *
 * Bridges a LiveKit Room's data publish/subscribe API to a per-participant
 * MessagePort using the MessageChannel pattern, enabling use with any code
 * that expects standard MessagePort interface (e.g. messageport-duplex).
 *
 * Unlike PeerJS or raw WebRTC which have dedicated data channels per peer,
 * LiveKit uses a room-wide pub/sub model. This adapter filters data by
 * participant identity to create a logical per-peer channel.
 */

import { DataPacket_Kind, type RemoteParticipant, type Room, RoomEvent } from "livekit-client";

import type { LiveKitPortOptions } from "./types.js";

/**
 * Cache of existing ports to ensure only one MessagePort per participant.
 * Prevents duplicate listeners on the same room+participant combination.
 */
const participantPorts = new WeakMap<Room, Map<string, MessagePort>>();

/**
 * Normalize incoming data to Uint8Array for MessagePort transport.
 */
function normalizeToUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new TextEncoder().encode(String(data));
}

/**
 * Create a MessagePort that bridges to a specific participant in a LiveKit room.
 *
 * Data sent to the returned port is published to the specified participant
 * via LiveKit's reliable data channel. Data received from that participant
 * is forwarded to the port as message events.
 *
 * Uses the MessageChannel bridge pattern (same as port-peerjs and port-webrtc):
 * - Creates a MessageChannel to get port1 and port2
 * - Returns port1 to the caller (standard MessagePort)
 * - Internally connects port2 to LiveKit's data pub/sub
 *
 * Returns the SAME port if called multiple times with the same room+participant.
 *
 * @param room - Connected LiveKit Room instance
 * @param participantIdentity - Identity of the remote participant to communicate with
 * @param options - Port options (reliable delivery, etc.)
 * @returns A standard MessagePort that bridges to the participant's data channel
 */
export function createLiveKitPort(
  room: Room,
  participantIdentity: string,
  options: LiveKitPortOptions = {},
): MessagePort {
  const { reliable = true } = options;

  // Return existing port if one was already created for this participant
  let roomPorts = participantPorts.get(room);
  if (roomPorts) {
    const existingPort = roomPorts.get(participantIdentity);
    if (existingPort) {
      return existingPort;
    }
  } else {
    roomPorts = new Map();
    participantPorts.set(room, roomPorts);
  }

  const { port1, port2 } = new MessageChannel();

  // port2 → LiveKit: forward messages to specific participant
  port2.onmessage = (e: MessageEvent) => {
    const data = e.data instanceof Uint8Array ? e.data : normalizeToUint8Array(e.data);
    room.localParticipant
      .publishData(data, {
        reliable,
        destinationIdentities: [participantIdentity],
      })
      .catch(() => {
        // Ignore publish errors when room is disconnecting
      });
  };

  // LiveKit → port2: forward incoming data from the specific participant
  const onDataReceived = (
    payload: Uint8Array,
    participant?: RemoteParticipant,
    kind?: DataPacket_Kind,
  ) => {
    if (participant?.identity !== participantIdentity) return;
    if (reliable && kind !== DataPacket_Kind.RELIABLE) return;

    const copy = new Uint8Array(payload);
    port2.postMessage(copy);
  };
  room.on(RoomEvent.DataReceived, onDataReceived);

  // Handle participant disconnect → signal end of stream
  const onParticipantDisconnected = (participant: RemoteParticipant) => {
    if (participant.identity !== participantIdentity) return;

    try {
      port2.postMessage(null);
    } catch {
      // Ignore if already closed
    }
    cleanup();
  };
  room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

  // Handle room disconnect
  const onDisconnected = () => {
    try {
      port2.postMessage(null);
    } catch {
      // Ignore if already closed
    }
    cleanup();
  };
  room.on(RoomEvent.Disconnected, onDisconnected);

  function cleanup() {
    room.off(RoomEvent.DataReceived, onDataReceived);
    room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.off(RoomEvent.Disconnected, onDisconnected);
    port2.close();
    roomPorts?.delete(participantIdentity);
  }

  // Override port1.close to trigger cleanup
  const nativeClose = port1.close.bind(port1);
  port1.close = () => {
    cleanup();
    nativeClose();
  };

  // Start receiving messages on port2
  port2.start();

  // Cache the port
  roomPorts.set(participantIdentity, port1);

  return port1;
}

/**
 * Create a MessagePort for a participant, waiting for them to connect if needed.
 *
 * If the participant is already in the room, returns immediately.
 * Otherwise waits for them to join (with optional timeout).
 *
 * @param room - Connected LiveKit Room instance
 * @param participantIdentity - Identity of the remote participant
 * @param options - Port options
 * @param timeout - Timeout in milliseconds (default: 30000)
 * @returns Promise resolving to MessagePort when participant is available
 */
export async function createLiveKitPortAsync(
  room: Room,
  participantIdentity: string,
  options: LiveKitPortOptions = {},
  timeout = 30000,
): Promise<MessagePort> {
  // Check if participant is already connected
  const existing = room.remoteParticipants.get(participantIdentity);
  if (existing) {
    return createLiveKitPort(room, participantIdentity, options);
  }

  // Wait for participant to join
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      room.off(RoomEvent.ParticipantConnected, onConnect);
      reject(new Error(`Timeout waiting for participant "${participantIdentity}" to connect`));
    }, timeout);

    const onConnect = (participant: RemoteParticipant) => {
      if (participant.identity === participantIdentity) {
        clearTimeout(timer);
        room.off(RoomEvent.ParticipantConnected, onConnect);
        resolve();
      }
    };
    room.on(RoomEvent.ParticipantConnected, onConnect);
  });

  return createLiveKitPort(room, participantIdentity, options);
}
