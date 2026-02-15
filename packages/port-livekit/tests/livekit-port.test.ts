/**
 * Tests for LiveKit port adapter.
 *
 * Uses mock LiveKit Room/Participant to test the MessagePort bridge
 * without requiring a real LiveKit server.
 */

import { ConnectionState, DataPacket_Kind, RoomEvent } from "livekit-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveKitPort, createLiveKitPortAsync } from "../src/livekit-port.js";

// --- Mock LiveKit types ---

type RoomEventHandler = (...args: unknown[]) => void;

interface MockRemoteParticipant {
  identity: string;
  name: string;
}

function createMockRoom() {
  const handlers = new Map<string | symbol, Set<RoomEventHandler>>();
  const remoteParticipants = new Map<string, MockRemoteParticipant>();

  const room = {
    state: ConnectionState.Connected as string,
    remoteParticipants,

    localParticipant: {
      identity: "local-user",
      publishData: vi.fn().mockResolvedValue(undefined),
    },

    on(event: string | symbol, handler: RoomEventHandler) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      return room;
    },

    off(event: string | symbol, handler: RoomEventHandler) {
      const set = handlers.get(event);
      if (set) {
        set.delete(handler);
      }
      return room;
    },

    // Test helpers
    _emit(event: string | symbol, ...args: unknown[]) {
      const set = handlers.get(event);
      if (set) {
        for (const handler of set) {
          handler(...args);
        }
      }
    },

    _addParticipant(identity: string) {
      const p: MockRemoteParticipant = { identity, name: identity };
      remoteParticipants.set(identity, p);
      room._emit(RoomEvent.ParticipantConnected, p);
      return p;
    },

    _removeParticipant(identity: string) {
      const p = remoteParticipants.get(identity);
      if (p) {
        remoteParticipants.delete(identity);
        room._emit(RoomEvent.ParticipantDisconnected, p);
      }
    },

    _simulateData(payload: Uint8Array, participant: MockRemoteParticipant, kind: DataPacket_Kind) {
      room._emit(RoomEvent.DataReceived, payload, participant, kind);
    },

    _disconnect() {
      room.state = ConnectionState.Disconnected;
      room._emit(RoomEvent.Disconnected);
    },
  };

  return room;
}

type MockRoom = ReturnType<typeof createMockRoom>;

describe("createLiveKitPort", () => {
  let room: MockRoom;
  let peerParticipant: MockRemoteParticipant;

  beforeEach(() => {
    room = createMockRoom();
    peerParticipant = room._addParticipant("peer-user");
  });

  it("should return a standard MessagePort", () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const port = createLiveKitPort(room as any, "peer-user");

    expect(port).toBeDefined();
    expect(port.postMessage).toBeDefined();
    expect(port.close).toBeDefined();
    expect(port.start).toBeDefined();
    expect(port.addEventListener).toBeDefined();
  });

  it("should forward postMessage to room.localParticipant.publishData", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const port = createLiveKitPort(room as any, "peer-user");
    port.start();

    const data = new Uint8Array([1, 2, 3]);
    port.postMessage(data);

    // Allow internal port2.onmessage to process
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(room.localParticipant.publishData).toHaveBeenCalled();
    const call = room.localParticipant.publishData.mock.calls[0];
    expect(new Uint8Array(call[0])).toEqual(data);
    expect(call[1].reliable).toBe(true);
    expect(call[1].destinationIdentities).toEqual(["peer-user"]);
  });

  it("should forward incoming data from the target participant", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const port = createLiveKitPort(room as any, "peer-user");
    const handler = vi.fn();
    port.addEventListener("message", handler);
    port.start();

    const data = new Uint8Array([4, 5, 6]);
    room._simulateData(data, peerParticipant, DataPacket_Kind.RELIABLE);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(handler).toHaveBeenCalled();
    const received = new Uint8Array(handler.mock.calls[0][0].data);
    expect(received).toEqual(data);
  });

  it("should ignore data from other participants", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const port = createLiveKitPort(room as any, "peer-user");
    const handler = vi.fn();
    port.addEventListener("message", handler);
    port.start();

    const otherParticipant = room._addParticipant("other-user");
    room._simulateData(new Uint8Array([7, 8, 9]), otherParticipant, DataPacket_Kind.RELIABLE);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(handler).not.toHaveBeenCalled();
  });

  it("should ignore lossy data when reliable mode is on", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const port = createLiveKitPort(room as any, "peer-user", { reliable: true });
    const handler = vi.fn();
    port.addEventListener("message", handler);
    port.start();

    room._simulateData(new Uint8Array([1, 2]), peerParticipant, DataPacket_Kind.LOSSY);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(handler).not.toHaveBeenCalled();
  });

  it("should send null on participant disconnect (EOF signal)", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const port = createLiveKitPort(room as any, "peer-user");
    const handler = vi.fn();
    port.addEventListener("message", handler);
    port.start();

    room._removeParticipant("peer-user");

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].data).toBe(null);
  });

  it("should send null on room disconnect", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const port = createLiveKitPort(room as any, "peer-user");
    const handler = vi.fn();
    port.addEventListener("message", handler);
    port.start();

    room._disconnect();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].data).toBe(null);
  });

  it("should return cached port for same room+participant", () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const port1 = createLiveKitPort(room as any, "peer-user");
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const port2 = createLiveKitPort(room as any, "peer-user");

    expect(port1).toBe(port2);
  });

  it("should return different ports for different participants", () => {
    room._addParticipant("other-user");

    // biome-ignore lint/suspicious/noExplicitAny: mock
    const port1 = createLiveKitPort(room as any, "peer-user");
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const port2 = createLiveKitPort(room as any, "other-user");

    expect(port1).not.toBe(port2);
  });
});

describe("createLiveKitPortAsync", () => {
  let room: MockRoom;

  beforeEach(() => {
    room = createMockRoom();
  });

  it("should return immediately if participant is already connected", async () => {
    room._addParticipant("peer-user");

    // biome-ignore lint/suspicious/noExplicitAny: mock
    const port = await createLiveKitPortAsync(room as any, "peer-user");
    expect(port).toBeDefined();
    expect(port.postMessage).toBeDefined();
  });

  it("should wait for participant to join", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock
    const portPromise = createLiveKitPortAsync(room as any, "peer-user");

    // Participant joins after a delay
    setTimeout(() => room._addParticipant("peer-user"), 50);

    const port = await portPromise;
    expect(port).toBeDefined();
  });

  it("should reject on timeout", async () => {
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: mock
      createLiveKitPortAsync(room as any, "peer-user", {}, 50),
    ).rejects.toThrow("Timeout waiting for participant");
  });
});
