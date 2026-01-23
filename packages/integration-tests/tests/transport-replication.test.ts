/**
 * Transport Replication Integration Tests
 *
 * Tests that verify repository data can be replicated correctly over the
 * MessagePortLike transport layer with ACK-based backpressure.
 */

import type { GitStore } from "@statewalker/vcs-commands";
import type { Packet } from "@statewalker/vcs-transport";
import {
  createPortTransportConnection,
  type TransportConnection,
} from "@statewalker/vcs-transport";
import { wrapNativePort } from "@statewalker/vcs-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryFactory } from "./backend-factories.js";
import { createCommit, createInitializedGitFromFactory, toArray } from "./test-helper.js";

/**
 * Create a connected pair of TransportConnections for testing.
 */
function createTestTransportPair(): {
  local: TransportConnection;
  remote: TransportConnection;
  cleanup: () => void;
} {
  const channel = new MessageChannel();
  const port1 = wrapNativePort(channel.port1);
  const port2 = wrapNativePort(channel.port2);

  const local = createPortTransportConnection(port1, { blockSize: 64 * 1024 });
  const remote = createPortTransportConnection(port2, { blockSize: 64 * 1024 });

  return {
    local,
    remote,
    cleanup: () => {
      local.close();
      remote.close();
      channel.port1.close();
      channel.port2.close();
    },
  };
}

// Helper to create Uint8Array from string
function text(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// Helper to decode Uint8Array to string
function decode(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

// Collect all packets from a stream
async function collectPackets(stream: AsyncIterable<Packet>): Promise<Packet[]> {
  const result: Packet[] = [];
  for await (const packet of stream) {
    result.push(packet);
  }
  return result;
}

// Extract data from data packets
function extractData(packets: Packet[]): Uint8Array[] {
  return packets.filter((p) => p.type === "data" && p.data).map((p) => p.data as Uint8Array);
}

describe("Transport Replication", () => {
  // localStore is available but not directly used in most tests
  // (we use the transport layer abstraction instead)
  let _localStore: GitStore;
  let remoteStore: GitStore;
  let localCleanup: (() => Promise<void>) | undefined;
  let remoteCleanup: (() => Promise<void>) | undefined;
  let transport: {
    local: TransportConnection;
    remote: TransportConnection;
    cleanup: () => void;
  };

  beforeEach(async () => {
    // Create two in-memory repositories
    const localCtx = await createInitializedGitFromFactory(memoryFactory);
    _localStore = localCtx.store;
    localCleanup = localCtx.cleanup;

    const remoteCtx = await createInitializedGitFromFactory(memoryFactory);
    remoteStore = remoteCtx.store;
    remoteCleanup = remoteCtx.cleanup;

    // Create connected transports
    transport = createTestTransportPair();
  });

  afterEach(async () => {
    transport?.cleanup();
    if (localCleanup) await localCleanup();
    if (remoteCleanup) await remoteCleanup();
  });

  // =============================================================================
  // Basic transport tests
  // =============================================================================

  it("should send and receive git protocol packets", async () => {
    // Simulate a simple git protocol exchange
    async function* generatePackets(): AsyncGenerator<Packet> {
      yield { type: "data", data: text("want abc123\n") };
      yield { type: "data", data: text("have def456\n") };
      yield { type: "flush" };
    }

    const sendPromise = transport.local.send(generatePackets());
    const received = await collectPackets(transport.remote.receive());
    await sendPromise;

    expect(received).toHaveLength(3);
    expect(received[0].type).toBe("data");
    expect(received[1].type).toBe("data");
    expect(received[2].type).toBe("flush");

    const data = extractData(received);
    expect(decode(data[0])).toBe("want abc123\n");
    expect(decode(data[1])).toBe("have def456\n");
  });

  it("should handle bidirectional communication (request/response)", async () => {
    // Client sends request
    async function* clientRequest(): AsyncGenerator<Packet> {
      yield { type: "data", data: text("want refs/heads/main\n") };
      yield { type: "flush" };
    }

    // Server sends response
    async function* serverResponse(): AsyncGenerator<Packet> {
      yield { type: "data", data: text("ACK refs/heads/main\n") };
      yield { type: "data", data: text("PACK data here...") };
      yield { type: "flush" };
    }

    // Phase 1: Client -> Server
    const clientSendPromise = transport.local.send(clientRequest());
    const serverReceived = await collectPackets(transport.remote.receive());
    await clientSendPromise;

    expect(serverReceived).toHaveLength(2);
    expect(decode(extractData(serverReceived)[0])).toContain("want");

    // Phase 2: Server -> Client
    const serverSendPromise = transport.remote.send(serverResponse());
    const clientReceived = await collectPackets(transport.local.receive());
    await serverSendPromise;

    expect(clientReceived).toHaveLength(3);
    expect(decode(extractData(clientReceived)[0])).toContain("ACK");
  });

  // =============================================================================
  // Large data transfer tests
  // =============================================================================

  it("should transfer large binary blobs with integrity", async () => {
    // Create a large blob in chunks (git pkt-line has max packet size of ~65KB)
    // We'll send 1MB as multiple packets of 60KB each
    const chunkSize = 60000;
    const totalSize = 1024 * 1024;
    const numChunks = Math.ceil(totalSize / chunkSize);

    async function* generateLargeData(): AsyncGenerator<Packet> {
      for (let i = 0; i < numChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, totalSize);
        const chunk = new Uint8Array(end - start);
        for (let j = 0; j < chunk.length; j++) {
          chunk[j] = (start + j) % 256;
        }
        yield { type: "data", data: chunk };
      }
      yield { type: "flush" };
    }

    const sendPromise = transport.local.send(generateLargeData());
    const received = await collectPackets(transport.remote.receive());
    await sendPromise;

    expect(received).toHaveLength(numChunks + 1);
    expect(received[received.length - 1].type).toBe("flush");

    // Reconstruct and verify data integrity
    const reconstructed = new Uint8Array(totalSize);
    let offset = 0;
    for (const packet of received) {
      if (packet.type === "data" && packet.data) {
        reconstructed.set(packet.data, offset);
        offset += packet.data.length;
      }
    }

    expect(offset).toBe(totalSize);

    // Verify pattern
    expect(reconstructed[0]).toBe(0);
    expect(reconstructed[1023]).toBe(255);
    expect(reconstructed[1024]).toBe(0);
    expect(reconstructed[totalSize - 1]).toBe((totalSize - 1) % 256);
  });

  it("should transfer many small packets efficiently", async () => {
    const packetCount = 100;

    async function* generateManyPackets(): AsyncGenerator<Packet> {
      for (let i = 0; i < packetCount; i++) {
        yield { type: "data", data: text(`packet-${i.toString().padStart(3, "0")}\n`) };
      }
      yield { type: "flush" };
    }

    const sendPromise = transport.local.send(generateManyPackets());
    const received = await collectPackets(transport.remote.receive());
    await sendPromise;

    expect(received).toHaveLength(packetCount + 1);

    // Verify packet order
    const dataPackets = extractData(received);
    expect(decode(dataPackets[0])).toBe("packet-000\n");
    expect(decode(dataPackets[49])).toBe("packet-049\n");
    expect(decode(dataPackets[99])).toBe("packet-099\n");
  });

  // =============================================================================
  // Backpressure tests
  // =============================================================================

  it("should handle backpressure with slow receiver", async () => {
    // Create data in chunks (respecting pkt-line max size)
    const chunkSize = 50000;
    const numChunks = 10;
    const totalSize = chunkSize * numChunks;

    async function* generateData(): AsyncGenerator<Packet> {
      for (let i = 0; i < numChunks; i++) {
        const chunk = new Uint8Array(chunkSize);
        for (let j = 0; j < chunkSize; j++) {
          chunk[j] = (i * chunkSize + j) % 256;
        }
        yield { type: "data", data: chunk };
      }
      yield { type: "flush" };
    }

    let receivedBytes = 0;
    let totalTime = 0;

    const receivePromise = (async () => {
      const start = performance.now();
      for await (const packet of transport.remote.receive()) {
        if (packet.type === "data" && packet.data) {
          receivedBytes += packet.data.length;
          // Simulate slow processing
          await new Promise((r) => setTimeout(r, 5));
        }
      }
      totalTime = performance.now() - start;
    })();

    const sendPromise = transport.local.send(generateData());

    await Promise.all([sendPromise, receivePromise]);

    // All data should be received
    expect(receivedBytes).toBe(totalSize);
    // Processing should take at least some time due to delays
    expect(totalTime).toBeGreaterThan(0);
  });

  // =============================================================================
  // Repository data transfer tests
  // =============================================================================

  it("should transfer blob content between repositories", async () => {
    // Add a file to remote store
    await createCommit(remoteStore, "Add test file", {
      "test.txt": "Hello, world!",
    });

    // Get the HEAD commit
    const headRef = await remoteStore.refs.resolve("HEAD");
    if (!headRef) {
      throw new Error("HEAD ref not found");
    }

    const commit = await remoteStore.commits.loadCommit(headRef.objectId);
    const tree = await toArray(remoteStore.trees.loadTree(commit.tree));

    // Find the test.txt entry (TreeEntry has 'name' and 'id' properties)
    const testFileEntry = tree.find((e) => e.name === "test.txt");
    if (!testFileEntry) {
      const names = tree.map((e) => e.name);
      throw new Error(`test.txt not found in tree. Available names: ${names.join(", ")}`);
    }

    // Load blob content
    const blobChunks: Uint8Array[] = [];
    for await (const chunk of remoteStore.blobs.load(testFileEntry.id)) {
      blobChunks.push(chunk);
    }
    const blobContent = new Uint8Array(blobChunks.reduce((sum, c) => sum + c.length, 0));
    let offset = 0;
    for (const chunk of blobChunks) {
      blobContent.set(chunk, offset);
      offset += chunk.length;
    }

    // Transfer blob via transport
    async function* sendBlob(): AsyncGenerator<Packet> {
      yield { type: "data", data: blobContent };
      yield { type: "flush" };
    }

    const sendPromise = transport.local.send(sendBlob());
    const received = await collectPackets(transport.remote.receive());
    await sendPromise;

    // Verify transfer
    expect(received).toHaveLength(2);
    expect(received[0].type).toBe("data");
    const receivedContent = received[0].type === "data" ? received[0].data : undefined;
    expect(receivedContent).toBeDefined();
    expect(decode(receivedContent as Uint8Array)).toBe("Hello, world!");
  });

  it("should transfer commit metadata", async () => {
    // Create commit in remote
    const commitId = await createCommit(remoteStore, "Test commit message", {
      "file.txt": "content",
    });

    // Load commit data
    const commit = await remoteStore.commits.loadCommit(commitId);
    const commitData = text(
      JSON.stringify({
        tree: commit.tree,
        parents: commit.parents,
        message: commit.message,
        author: commit.author,
        committer: commit.committer,
      }),
    );

    // Transfer commit via transport
    async function* sendCommit(): AsyncGenerator<Packet> {
      yield { type: "data", data: commitData };
      yield { type: "flush" };
    }

    const sendPromise = transport.local.send(sendCommit());
    const received = await collectPackets(transport.remote.receive());
    await sendPromise;

    // Verify transfer
    expect(received[0].type).toBe("data");
    const receivedData = received[0].type === "data" ? received[0].data : undefined;
    expect(receivedData).toBeDefined();
    const parsedCommit = JSON.parse(decode(receivedData as Uint8Array));

    expect(parsedCommit.message).toBe("Test commit message");
    expect(parsedCommit.tree).toBe(commit.tree);
  });

  // =============================================================================
  // Error handling tests
  // =============================================================================

  it("should handle closed connection gracefully", async () => {
    // Close the connection
    await transport.local.close();

    // Trying to send should throw
    async function* packets(): AsyncGenerator<Packet> {
      yield { type: "flush" };
    }

    await expect(transport.local.send(packets())).rejects.toThrow(/closed/i);
  });
});
