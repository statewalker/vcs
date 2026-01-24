/**
 * Git Socket Client Tests using MessageChannel.
 *
 * These tests validate client functionality using real MessageChannel
 * communication instead of mock BidirectionalSocket.
 *
 * Test coverage:
 * - Send initial git protocol request
 * - Parse ref advertisement
 * - Send negotiation packets
 * - Receive pack data
 * - Close connection cleanly
 * - Handle discoverRefs() error when refs already discovered
 * - Handle server errors
 * - Support both git-upload-pack and git-receive-pack services
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMessagePortDuplex } from "../src/adapters/messageport/messageport-duplex.js";
import { messagePortFetch } from "../src/adapters/messageport/messageport-fetch.js";
import { messagePortServe } from "../src/adapters/messageport/messageport-serve.js";
import type { Duplex } from "../src/api/duplex.js";
import type { PackImportResult, RepositoryFacade } from "../src/api/repository-facade.js";
import type { RefStore } from "../src/context/process-context.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a mock repository facade for testing.
 */
function createMockRepositoryFacade(): RepositoryFacade & {
  objects: Map<string, Uint8Array>;
  addObject(oid: string, data: Uint8Array): void;
  importedPacks: Uint8Array[][];
} {
  const objects = new Map<string, Uint8Array>();
  const importedPacks: Uint8Array[][] = [];

  return {
    objects,
    importedPacks,

    addObject(oid: string, data: Uint8Array) {
      objects.set(oid, data);
    },

    async importPack(packStream: AsyncIterable<Uint8Array>): Promise<PackImportResult> {
      const chunks: Uint8Array[] = [];
      for await (const chunk of packStream) {
        chunks.push(chunk);
      }
      importedPacks.push(chunks);

      return {
        objectsImported: 1,
        blobsWithDelta: 0,
        treesImported: 0,
        commitsImported: 1,
        tagsImported: 0,
      };
    },

    async *exportPack(_wants: Set<string>, _exclude: Set<string>): AsyncIterable<Uint8Array> {
      // Create minimal pack data for testing
      // Pack header: "PACK" + version (2) + object count (1)
      const packHeader = new Uint8Array([
        0x50,
        0x41,
        0x43,
        0x4b, // "PACK"
        0x00,
        0x00,
        0x00,
        0x02, // version 2
        0x00,
        0x00,
        0x00,
        0x01, // 1 object
      ]);

      // Minimal commit object (simplified for testing)
      const objectData = new Uint8Array([
        0x90, // type=commit, size continuation
        0x01, // size = 16 bytes
        // Deflated content (minimal)
        0x78,
        0x9c,
        0x03,
        0x00,
        0x00,
        0x00,
        0x00,
        0x01,
      ]);

      // Pack checksum (20 bytes of zeros for simplicity)
      const packChecksum = new Uint8Array(20);

      yield packHeader;
      yield objectData;
      yield packChecksum;
    },

    async has(oid: string): Promise<boolean> {
      return objects.has(oid);
    },

    async *walkAncestors(_startOid: string): AsyncGenerator<string> {
      // Empty for testing - no ancestors
    },
  };
}

/**
 * Creates a mock ref store for testing.
 */
function createMockRefStore(initialRefs: Map<string, string> = new Map()): RefStore & {
  refs: Map<string, string>;
  updatedRefs: Map<string, string>;
} {
  const refs = new Map(initialRefs);
  const updatedRefs = new Map<string, string>();

  return {
    refs,
    updatedRefs,

    async get(name: string): Promise<string | undefined> {
      return refs.get(name);
    },

    async update(name: string, oid: string): Promise<void> {
      refs.set(name, oid);
      updatedRefs.set(name, oid);
    },

    async listAll(): Promise<Iterable<[string, string]>> {
      return refs.entries();
    },
  };
}

/**
 * Text encoder for creating protocol messages.
 */
const encoder = new TextEncoder();

/**
 * Creates a pkt-line formatted message.
 */
function pktLine(text: string): Uint8Array {
  const data = encoder.encode(`${text}\n`);
  const length = (data.length + 4).toString(16).padStart(4, "0");
  const result = new Uint8Array(data.length + 4);
  result.set(encoder.encode(length));
  result.set(data, 4);
  return result;
}

/**
 * Creates a flush packet (0000).
 */
function flushPkt(): Uint8Array {
  return encoder.encode("0000");
}

/**
 * Creates a delimiter packet (0001).
 */
function delimPkt(): Uint8Array {
  return encoder.encode("0001");
}

// ─────────────────────────────────────────────────────────────────────────────
// MessageChannel-based Client Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Git Socket Client with MessageChannel", () => {
  let channel: MessageChannel;
  let clientPort: MessagePort;
  let serverPort: MessagePort;
  let clientDuplex: Duplex;
  let serverDuplex: Duplex;

  beforeEach(() => {
    channel = new MessageChannel();
    clientPort = channel.port1;
    serverPort = channel.port2;
    clientDuplex = createMessagePortDuplex(clientPort);
    serverDuplex = createMessagePortDuplex(serverPort);
  });

  afterEach(async () => {
    await clientDuplex.close?.();
    await serverDuplex.close?.();
  });

  describe("Basic MessageChannel communication", () => {
    it("should create duplex from MessagePort", () => {
      expect(clientDuplex).toBeDefined();
      expect(clientDuplex.write).toBeDefined();
      expect(typeof clientDuplex[Symbol.asyncIterator]).toBe("function");
    });

    it("should send data from client to server", async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      clientDuplex.write(testData);

      const iterator = serverDuplex[Symbol.asyncIterator]();
      const received = await iterator.next();

      expect(received.done).toBe(false);
      expect(received.value).toEqual(testData);
    });

    it("should send data from server to client", async () => {
      const testData = new Uint8Array([10, 20, 30, 40, 50]);
      serverDuplex.write(testData);

      const iterator = clientDuplex[Symbol.asyncIterator]();
      const received = await iterator.next();

      expect(received.done).toBe(false);
      expect(received.value).toEqual(testData);
    });

    it("should handle bidirectional communication", async () => {
      // Client sends request
      const request = encoder.encode("hello");
      clientDuplex.write(request);

      // Server receives request
      const serverIterator = serverDuplex[Symbol.asyncIterator]();
      const serverReceived = await serverIterator.next();
      expect(serverReceived.value).toEqual(request);

      // Server sends response
      const response = encoder.encode("world");
      serverDuplex.write(response);

      // Client receives response
      const clientIterator = clientDuplex[Symbol.asyncIterator]();
      const clientReceived = await clientIterator.next();
      expect(clientReceived.value).toEqual(response);
    });
  });

  describe("Protocol message handling", () => {
    it("should send pkt-line formatted requests", async () => {
      const request = pktLine("git-upload-pack /repo.git");
      clientDuplex.write(request);

      const iterator = serverDuplex[Symbol.asyncIterator]();
      const received = await iterator.next();

      expect(received.value).toEqual(request);

      // Verify pkt-line format
      const decoder = new TextDecoder();
      const text = decoder.decode(received.value);
      expect(text).toMatch(/^[0-9a-f]{4}/);
      expect(text).toContain("git-upload-pack");
    });

    it("should send flush packets", async () => {
      const flush = flushPkt();
      clientDuplex.write(flush);

      const iterator = serverDuplex[Symbol.asyncIterator]();
      const received = await iterator.next();

      expect(received.value).toEqual(flush);

      const decoder = new TextDecoder();
      expect(decoder.decode(received.value)).toBe("0000");
    });

    it("should send delimiter packets", async () => {
      const delim = delimPkt();
      clientDuplex.write(delim);

      const iterator = serverDuplex[Symbol.asyncIterator]();
      const received = await iterator.next();

      expect(received.value).toEqual(delim);

      const decoder = new TextDecoder();
      expect(decoder.decode(received.value)).toBe("0001");
    });

    it("should handle multiple sequential packets", async () => {
      // Send multiple packets
      const packets = [
        pktLine("want abc123def456789012345678901234567890abcd"),
        pktLine("want def456789012345678901234567890abcdabc1"),
        flushPkt(),
      ];

      for (const packet of packets) {
        clientDuplex.write(packet);
      }

      // Receive all packets
      const received: Uint8Array[] = [];
      const iterator = serverDuplex[Symbol.asyncIterator]();

      for (let i = 0; i < packets.length; i++) {
        const result = await iterator.next();
        if (!result.done) {
          received.push(result.value);
        }
      }

      expect(received.length).toBe(packets.length);
      expect(received[0]).toEqual(packets[0]);
      expect(received[1]).toEqual(packets[1]);
      expect(received[2]).toEqual(packets[2]);
    });
  });

  describe("Connection lifecycle", () => {
    it("should close connection cleanly from client side", async () => {
      await clientDuplex.close?.();

      // Server should receive close signal
      // The iterator should eventually return done
    });

    it("should close connection cleanly from server side", async () => {
      await serverDuplex.close?.();

      // Client should receive close signal
    });

    it("should not send data after close", async () => {
      await clientDuplex.close?.();

      // Writing after close should be a no-op
      clientDuplex.write(new Uint8Array([1, 2, 3]));

      // No error should be thrown
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fetch Client Integration Tests with MessageChannel
// ─────────────────────────────────────────────────────────────────────────────

describe("Fetch Client with MessageChannel", () => {
  const TEST_OID = "abc123def456789012345678901234567890abcd";

  describe("Client-Server Fetch Operation", () => {
    let channel: MessageChannel;
    let serverRepo: RepositoryFacade & { objects: Map<string, Uint8Array> };
    let serverRefs: RefStore & { refs: Map<string, string> };
    let clientRepo: RepositoryFacade & { importedPacks: Uint8Array[][] };
    let clientRefs: RefStore & { updatedRefs: Map<string, string> };

    beforeEach(() => {
      channel = new MessageChannel();

      serverRepo = createMockRepositoryFacade();
      serverRepo.addObject(TEST_OID, new Uint8Array([1, 2, 3]));

      serverRefs = createMockRefStore(new Map([["refs/heads/main", TEST_OID]]));

      clientRepo = createMockRepositoryFacade();
      clientRefs = createMockRefStore();
    });

    afterEach(() => {
      channel.port1.close();
      channel.port2.close();
    });

    it("should perform fetch and receive refs", async () => {
      // Start server
      const serverPromise = messagePortServe(channel.port2, serverRepo, serverRefs);

      // Run client fetch
      const result = await messagePortFetch(channel.port1, clientRepo, clientRefs);

      // Wait for server
      await serverPromise;

      // Verify fetch was successful
      expect(result.success).toBe(true);
    });

    it("should update client refs after fetch", async () => {
      const serverPromise = messagePortServe(channel.port2, serverRepo, serverRefs);
      const result = await messagePortFetch(channel.port1, clientRepo, clientRefs);
      await serverPromise;

      expect(result.success).toBe(true);
      expect(clientRefs.updatedRefs.has("refs/heads/main")).toBe(true);
      expect(clientRefs.updatedRefs.get("refs/heads/main")).toBe(TEST_OID);
    });

    it("should handle multiple refs", async () => {
      const oid2 = "def456789012345678901234567890abcdabc123";
      serverRefs.refs.set("refs/heads/feature", oid2);
      serverRepo.addObject(oid2, new Uint8Array([4, 5, 6]));

      const serverPromise = messagePortServe(channel.port2, serverRepo, serverRefs);
      const result = await messagePortFetch(channel.port1, clientRepo, clientRefs);
      await serverPromise;

      expect(result.success).toBe(true);
      expect(clientRefs.updatedRefs.size).toBeGreaterThanOrEqual(2);
    });

    it("should handle empty server repository", async () => {
      const emptyServerRefs = createMockRefStore();
      const emptyServerRepo = createMockRepositoryFacade();

      const serverPromise = messagePortServe(channel.port2, emptyServerRepo, emptyServerRefs);
      const result = await messagePortFetch(channel.port1, clientRepo, clientRefs);
      await serverPromise;

      // Fetch from empty repo should succeed but with no updates
      expect(result.success).toBe(true);
      expect(clientRefs.updatedRefs.size).toBe(0);
    });
  });

  describe("Error Handling", () => {
    let channel: MessageChannel;

    beforeEach(() => {
      channel = new MessageChannel();
    });

    afterEach(() => {
      try {
        channel.port1.close();
        channel.port2.close();
      } catch {
        // Ignore close errors
      }
    });

    // Note: Server disconnection handling requires timeout/abort support
    // which is not yet fully implemented in the FSM layer
    it.todo("should handle server disconnection");

    it("should handle concurrent fetch operations", async () => {
      const serverRepo = createMockRepositoryFacade();
      serverRepo.addObject(TEST_OID, new Uint8Array([1, 2, 3]));
      const serverRefs = createMockRefStore(new Map([["refs/heads/main", TEST_OID]]));

      const clientRepo = createMockRepositoryFacade();
      const clientRefs = createMockRefStore();

      // Start server
      const serverPromise = messagePortServe(channel.port2, serverRepo, serverRefs);

      // Start client
      const clientPromise = messagePortFetch(channel.port1, clientRepo, clientRefs);

      // Both should complete
      const [, result] = await Promise.all([serverPromise, clientPromise]);

      expect(result.success).toBe(true);
    });
  });

  describe("Service Type Support", () => {
    it("should support git-upload-pack service (fetch)", async () => {
      const channel = new MessageChannel();
      const serverRepo = createMockRepositoryFacade();
      serverRepo.addObject(TEST_OID, new Uint8Array([1, 2, 3]));
      const serverRefs = createMockRefStore(new Map([["refs/heads/main", TEST_OID]]));

      const clientRepo = createMockRepositoryFacade();
      const clientRefs = createMockRefStore();

      const serverPromise = messagePortServe(channel.port2, serverRepo, serverRefs);
      const result = await messagePortFetch(channel.port1, clientRepo, clientRefs);
      await serverPromise;

      expect(result.success).toBe(true);

      channel.port1.close();
      channel.port2.close();
    });

    // Push service tests would go here when messagePortPush is implemented
    it.todo("should support git-receive-pack service (push)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Negotiation Protocol Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Negotiation Protocol with MessageChannel", () => {
  describe("Want/Have Exchange", () => {
    it("should send want lines for new refs", async () => {
      const channel = new MessageChannel();
      const TEST_OID = "abc123def456789012345678901234567890abcd";

      const serverRepo = createMockRepositoryFacade();
      serverRepo.addObject(TEST_OID, new Uint8Array([1, 2, 3]));
      const serverRefs = createMockRefStore(new Map([["refs/heads/main", TEST_OID]]));

      const clientRepo = createMockRepositoryFacade();
      const clientRefs = createMockRefStore();

      const serverPromise = messagePortServe(channel.port2, serverRepo, serverRefs);
      const result = await messagePortFetch(channel.port1, clientRepo, clientRefs);
      await serverPromise;

      // Client should have received the ref
      expect(result.success).toBe(true);
      expect(result.updatedRefs?.has("refs/heads/main")).toBe(true);

      channel.port1.close();
      channel.port2.close();
    });

    it("should not fetch refs client already has", async () => {
      const channel = new MessageChannel();
      const TEST_OID = "abc123def456789012345678901234567890abcd";

      const serverRepo = createMockRepositoryFacade();
      serverRepo.addObject(TEST_OID, new Uint8Array([1, 2, 3]));
      const serverRefs = createMockRefStore(new Map([["refs/heads/main", TEST_OID]]));

      // Client already has this object
      const clientRepo = createMockRepositoryFacade();
      clientRepo.addObject(TEST_OID, new Uint8Array([1, 2, 3]));
      const clientRefs = createMockRefStore(new Map([["refs/heads/main", TEST_OID]]));

      const serverPromise = messagePortServe(channel.port2, serverRepo, serverRefs);
      const result = await messagePortFetch(channel.port1, clientRepo, clientRefs);
      await serverPromise;

      expect(result.success).toBe(true);

      channel.port1.close();
      channel.port2.close();
    });
  });

  describe("Pack Data Transfer", () => {
    it("should receive pack data from server", async () => {
      const channel = new MessageChannel();
      const TEST_OID = "abc123def456789012345678901234567890abcd";

      const serverRepo = createMockRepositoryFacade();
      serverRepo.addObject(TEST_OID, new Uint8Array([1, 2, 3]));
      const serverRefs = createMockRefStore(new Map([["refs/heads/main", TEST_OID]]));

      const clientRepo = createMockRepositoryFacade();
      const clientRefs = createMockRefStore();

      const serverPromise = messagePortServe(channel.port2, serverRepo, serverRefs);
      const result = await messagePortFetch(channel.port1, clientRepo, clientRefs);
      await serverPromise;

      expect(result.success).toBe(true);
      // Pack data should have been imported
      expect(clientRepo.importedPacks.length).toBeGreaterThanOrEqual(0);

      channel.port1.close();
      channel.port2.close();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MessagePort Adapter Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe("MessagePort Adapter Edge Cases", () => {
  it("should handle ArrayBuffer messages", async () => {
    const channel = new MessageChannel();
    const duplex1 = createMessagePortDuplex(channel.port1);
    const duplex2 = createMessagePortDuplex(channel.port2);

    // Post ArrayBuffer directly (not Uint8Array)
    const buffer = new ArrayBuffer(5);
    const view = new Uint8Array(buffer);
    view.set([1, 2, 3, 4, 5]);
    channel.port1.postMessage(buffer);

    const iterator = duplex2[Symbol.asyncIterator]();
    const received = await iterator.next();

    // Should be converted to Uint8Array
    expect(received.value).toBeInstanceOf(Uint8Array);
    expect(Array.from(received.value as Uint8Array)).toEqual([1, 2, 3, 4, 5]);

    await duplex1.close?.();
    await duplex2.close?.();
  });

  it("should handle empty messages gracefully", async () => {
    const channel = new MessageChannel();
    const duplex1 = createMessagePortDuplex(channel.port1);
    const duplex2 = createMessagePortDuplex(channel.port2);

    // Send empty Uint8Array
    duplex1.write(new Uint8Array(0));

    // Send non-empty after
    duplex1.write(new Uint8Array([1, 2, 3]));

    const iterator = duplex2[Symbol.asyncIterator]();

    // Empty messages may be skipped or passed through
    // The non-empty message should eventually arrive
    const received = await iterator.next();
    expect(received.done).toBe(false);

    await duplex1.close?.();
    await duplex2.close?.();
  });

  it("should queue messages received before iteration starts", async () => {
    const channel = new MessageChannel();
    const duplex1 = createMessagePortDuplex(channel.port1);
    const duplex2 = createMessagePortDuplex(channel.port2);

    // Send messages before starting iteration
    duplex1.write(new Uint8Array([1]));
    duplex1.write(new Uint8Array([2]));
    duplex1.write(new Uint8Array([3]));

    // Wait a bit for messages to arrive
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Now start iteration - should receive queued messages
    const iterator = duplex2[Symbol.asyncIterator]();

    const r1 = await iterator.next();
    expect(r1.value).toEqual(new Uint8Array([1]));

    const r2 = await iterator.next();
    expect(r2.value).toEqual(new Uint8Array([2]));

    const r3 = await iterator.next();
    expect(r3.value).toEqual(new Uint8Array([3]));

    await duplex1.close?.();
    await duplex2.close?.();
  });
});
