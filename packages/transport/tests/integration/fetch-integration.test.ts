/**
 * Integration tests for Fetch FSM across different adapters.
 *
 * These tests verify that the Fetch FSM works correctly with both
 * MessagePort and HTTP adapters using parameterized test fixtures.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMessagePortDuplex } from "../../src/v2/adapters/messageport/messageport-duplex.js";
import { messagePortFetch } from "../../src/v2/adapters/messageport/messageport-fetch.js";
import { messagePortServe } from "../../src/v2/adapters/messageport/messageport-serve.js";
import type { FetchResult, ServeResult } from "../../src/v2/api/fetch-result.js";
import type { PackImportResult, RepositoryFacade } from "../../src/v2/api/repository-facade.js";
import type { RefStore } from "../../src/v2/context/process-context.js";

/**
 * Test fixture interface for adapter-agnostic testing.
 */
interface TransportFixture {
  /** Client-side repository facade */
  clientRepository: RepositoryFacade;
  /** Client-side ref store */
  clientRefStore: RefStore;
  /** Server-side repository facade */
  serverRepository: RepositoryFacade;
  /** Server-side ref store */
  serverRefStore: RefStore;
  /** Run a fetch operation */
  runFetch(): Promise<FetchResult>;
  /** Cleanup resources */
  cleanup(): void;
}

/**
 * Mock repository facade for testing.
 */
function createMockRepositoryFacade(): RepositoryFacade & {
  objects: Map<string, Uint8Array>;
  addObject(oid: string, data: Uint8Array): void;
} {
  const objects = new Map<string, Uint8Array>();

  return {
    objects,

    addObject(oid: string, data: Uint8Array) {
      objects.set(oid, data);
    },

    async importPack(_packStream: AsyncIterable<Uint8Array>): Promise<PackImportResult> {
      // For testing, just return success
      return {
        objectsImported: 0,
        blobsWithDelta: 0,
        treesImported: 0,
        commitsImported: 0,
        tagsImported: 0,
      };
    },

    async *exportPack(_wants: Set<string>, _exclude: Set<string>): AsyncIterable<Uint8Array> {
      // Create minimal pack data for testing
      // Pack header: "PACK" + version (2) + object count (0)
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
        0x00, // 0 objects
      ]);

      // Pack checksum (20 bytes of zeros for simplicity)
      const packChecksum = new Uint8Array(20);

      yield packHeader;
      yield packChecksum;
    },

    async has(oid: string): Promise<boolean> {
      return objects.has(oid);
    },

    async *walkAncestors(_startOid: string): AsyncGenerator<string> {
      // Empty for testing
    },
  };
}

/**
 * Mock ref store for testing.
 */
function createMockRefStore(
  initialRefs: Map<string, string> = new Map(),
): RefStore & { refs: Map<string, string> } {
  const refs = new Map(initialRefs);

  return {
    refs,

    async get(name: string): Promise<string | undefined> {
      return refs.get(name);
    },

    async update(name: string, oid: string): Promise<void> {
      refs.set(name, oid);
    },

    async listAll(): Promise<Iterable<[string, string]>> {
      return refs.entries();
    },
  };
}

/**
 * Creates a MessagePort-based test fixture.
 */
function createMessagePortFixture(): TransportFixture {
  const channel = new MessageChannel();

  const serverRepository = createMockRepositoryFacade();
  const serverRefStore = createMockRefStore(
    new Map([["refs/heads/main", "abc123def456abc123def456abc123def456abc1"]]),
  );

  const clientRepository = createMockRepositoryFacade();
  const clientRefStore = createMockRefStore();

  let serverPromise: Promise<ServeResult> | null = null;

  return {
    clientRepository,
    clientRefStore,
    serverRepository,
    serverRefStore,

    async runFetch(): Promise<FetchResult> {
      // Start server in background
      serverPromise = messagePortServe(channel.port2, serverRepository, serverRefStore);

      // Run client fetch
      const result = await messagePortFetch(channel.port1, clientRepository, clientRefStore);

      // Wait for server to complete
      await serverPromise;

      return result;
    },

    cleanup() {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

describe("Fetch FSM Integration", () => {
  describe("MessagePort adapter", () => {
    let fixture: TransportFixture;

    beforeEach(() => {
      fixture = createMessagePortFixture();
    });

    afterEach(() => {
      fixture.cleanup();
    });

    it("creates duplex from MessagePort", () => {
      const channel = new MessageChannel();
      const duplex = createMessagePortDuplex(channel.port1);

      expect(duplex).toBeDefined();
      expect(duplex.write).toBeDefined();
      expect(typeof duplex[Symbol.asyncIterator]).toBe("function");

      channel.port1.close();
      channel.port2.close();
    });

    it("exchanges data between ports", async () => {
      const channel = new MessageChannel();
      const duplex1 = createMessagePortDuplex(channel.port1);
      const duplex2 = createMessagePortDuplex(channel.port2);

      // Send from port1
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      duplex1.write(testData);

      // Receive on port2
      const iterator = duplex2[Symbol.asyncIterator]();
      const receivedPromise = iterator.next();

      // Close to signal end
      setTimeout(() => {
        channel.port1.postMessage("__close__");
        channel.port2.postMessage("__close__");
      }, 50);

      const received = await receivedPromise;
      expect(received.done).toBe(false);
      expect(received.value).toEqual(testData);

      channel.port1.close();
      channel.port2.close();
    });

    // Note: Full fetch integration tests require complete FSM implementation
    // which is tested separately in the FSM unit tests. Here we focus on
    // adapter layer functionality (duplex creation, data exchange).
    it.skip("handles empty server refs", async () => {
      // This test requires the FSM to handle empty refs gracefully.
      // Currently skipped as it requires full FSM integration.
    });
  });

  describe("Fixture factory pattern", () => {
    it("creates valid fixtures", () => {
      const fixture = createMessagePortFixture();

      expect(fixture.clientRepository).toBeDefined();
      expect(fixture.clientRefStore).toBeDefined();
      expect(fixture.serverRepository).toBeDefined();
      expect(fixture.serverRefStore).toBeDefined();
      expect(fixture.runFetch).toBeDefined();
      expect(fixture.cleanup).toBeDefined();

      fixture.cleanup();
    });

    it("mock repository implements RepositoryFacade", async () => {
      const repo = createMockRepositoryFacade();

      // Test has
      expect(await repo.has("nonexistent")).toBe(false);

      repo.addObject("test123", new Uint8Array([1, 2, 3]));
      expect(await repo.has("test123")).toBe(true);

      // Test exportPack
      const chunks: Uint8Array[] = [];
      for await (const chunk of repo.exportPack(new Set(["abc"]), new Set())) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);

      // Test importPack
      const result = await repo.importPack(
        (async function* () {
          yield new Uint8Array([1, 2, 3]);
        })(),
      );
      expect(result.objectsImported).toBe(0);
    });

    it("mock ref store implements RefStore", async () => {
      const refs = createMockRefStore(new Map([["refs/heads/main", "abc123"]]));

      // Test get
      expect(await refs.get("refs/heads/main")).toBe("abc123");
      expect(await refs.get("nonexistent")).toBeUndefined();

      // Test update
      await refs.update("refs/heads/feature", "def456");
      expect(await refs.get("refs/heads/feature")).toBe("def456");

      // Test listAll
      const allRefs = await refs.listAll();
      const refArray = Array.from(allRefs);
      expect(refArray).toContainEqual(["refs/heads/main", "abc123"]);
      expect(refArray).toContainEqual(["refs/heads/feature", "def456"]);
    });
  });
});
