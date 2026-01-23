/**
 * Tests for Git socket client and server.
 *
 * Tests cover:
 * - Client: initial request format
 * - Client: ref discovery
 * - Client: packet send/receive
 * - Server: request parsing
 * - Server: authentication
 * - Server: repository resolution
 * - Integration: complete fetch/push flows
 */

import { describe, expect, it } from "vitest";
import type {
  HeadInfo,
  ObjectId,
  ObjectInfo,
  ObjectTypeCode,
  RefInfo,
  RepositoryAccess,
} from "../src/handlers/types.js";
import { encodeFlush, encodePacket, pktLineReader } from "../src/protocol/pkt-line-codec.js";
import {
  createGitSocketClient,
  createMessagePortReader,
  createMessagePortWriter,
  type GitSocketServerOptions,
  handleGitSocketConnection,
} from "../src/socket/index.js";

// Object type codes
const OBJ_COMMIT = 1 as ObjectTypeCode;

// Sample object IDs
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

/**
 * Create a pair of connected MessagePorts for testing.
 */
function createMessagePortPair(): [MessagePort, MessagePort] {
  const channel = new MessageChannel();
  return [channel.port1, channel.port2];
}

/**
 * Create a mock repository for testing.
 */
function createMockRepository(options?: {
  refs?: RefInfo[];
  head?: HeadInfo | null;
  objects?: Map<string, { type: ObjectTypeCode; content: Uint8Array }>;
}): RepositoryAccess {
  const refs = options?.refs ?? [{ name: "refs/heads/main", objectId: COMMIT_A }];
  const head = options?.head ?? { target: "refs/heads/main" };
  const objects = options?.objects ?? new Map();

  return {
    async *listRefs(): AsyncIterable<RefInfo> {
      for (const ref of refs) {
        yield ref;
      }
    },

    async getHead(): Promise<HeadInfo | null> {
      return head;
    },

    async hasObject(id: ObjectId): Promise<boolean> {
      return objects.has(id) || id === COMMIT_A;
    },

    async getObjectInfo(id: ObjectId): Promise<ObjectInfo | null> {
      const obj = objects.get(id);
      if (obj) {
        return { type: obj.type, size: obj.content.length };
      }
      if (id === COMMIT_A) {
        return { type: OBJ_COMMIT, size: 100 };
      }
      return null;
    },

    async *loadObject(id: ObjectId): AsyncIterable<Uint8Array> {
      const obj = objects.get(id);
      if (obj) {
        yield obj.content;
      }
    },

    async storeObject(_type: ObjectTypeCode, _content: Uint8Array): Promise<ObjectId> {
      return "stored".repeat(8).slice(0, 40);
    },

    async updateRef(
      _name: string,
      _oldId: ObjectId | null,
      _newId: ObjectId | null,
    ): Promise<boolean> {
      return true;
    },

    async *walkObjects(
      _wants: ObjectId[],
      _haves: ObjectId[],
    ): AsyncIterable<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
      // Empty for basic tests
    },
  };
}

// =============================================================================
// Client Tests
// =============================================================================

describe("GitSocketClient", () => {
  describe("discoverRefs", () => {
    it("should send correct initial request format", async () => {
      const [clientPort, serverPort] = createMessagePortPair();

      // Create client
      const client = createGitSocketClient(clientPort, {
        path: "/repo.git",
        host: "example.com",
        service: "git-upload-pack",
      });

      // Server side: read the initial request
      const serverInput = createMessagePortReader(serverPort);
      const serverWrite = createMessagePortWriter(serverPort);

      const serverRead = (async () => {
        const packets = pktLineReader(serverInput);
        const firstPacket = await packets[Symbol.asyncIterator]().next();
        expect(firstPacket.done).toBe(false);
        expect(firstPacket.value.type).toBe("data");

        const requestData = firstPacket.value.data ?? new Uint8Array();
        const requestLine = new TextDecoder().decode(requestData);
        expect(requestLine).toContain("git-upload-pack /repo.git");
        expect(requestLine).toContain("host=example.com");

        // Send minimal ref advertisement
        await serverWrite(encodePacket(`${COMMIT_A} refs/heads/main\0\n`));
        await serverWrite(encodeFlush());
        serverPort.postMessage(null); // Close signal
      })();

      // Client side: discover refs
      const refs = await client.discoverRefs();
      expect(refs.refs.has("refs/heads/main")).toBe(true);

      await serverRead;
      await client.close();
    });

    it("should throw when called twice", async () => {
      const [clientPort, serverPort] = createMessagePortPair();

      const client = createGitSocketClient(clientPort, {
        path: "/repo.git",
      });

      // Server: send ref advertisement
      const serverInput = createMessagePortReader(serverPort);
      const serverWrite = createMessagePortWriter(serverPort);

      const serverHandle = (async () => {
        // Wait for request
        const packets = pktLineReader(serverInput);
        await packets[Symbol.asyncIterator]().next();

        await serverWrite(encodePacket(`${COMMIT_A} refs/heads/main\0\n`));
        await serverWrite(encodeFlush());
        serverPort.postMessage(null); // Close signal
      })();

      await client.discoverRefs();

      // Second call should throw
      await expect(client.discoverRefs()).rejects.toThrow("Refs already discovered");

      await serverHandle;
      await client.close();
    });

    it("should use default host and service", async () => {
      const [clientPort, serverPort] = createMessagePortPair();

      const client = createGitSocketClient(clientPort, {
        path: "/test.git",
      });

      // Server side: verify defaults
      const serverInput = createMessagePortReader(serverPort);
      const serverWrite = createMessagePortWriter(serverPort);

      const serverRead = (async () => {
        const packets = pktLineReader(serverInput);
        const firstPacket = await packets[Symbol.asyncIterator]().next();
        const requestData = firstPacket.value.data ?? new Uint8Array();
        const requestLine = new TextDecoder().decode(requestData);

        expect(requestLine).toContain("git-upload-pack /test.git");
        expect(requestLine).toContain("host=localhost");

        await serverWrite(encodePacket(`${COMMIT_A} refs/heads/main\0\n`));
        await serverWrite(encodeFlush());
        serverPort.postMessage(null); // Close signal
      })();

      await client.discoverRefs();
      await serverRead;
      await client.close();
    });
  });

  describe("send and receive", () => {
    it("should send packets correctly", async () => {
      const [clientPort, serverPort] = createMessagePortPair();

      const client = createGitSocketClient(clientPort, {
        path: "/repo.git",
      });

      // Server: handle connection (simplified mock server)
      const serverInput = createMessagePortReader(serverPort);
      const serverWrite = createMessagePortWriter(serverPort);

      const serverHandle = (async () => {
        const packets = pktLineReader(serverInput);
        const iter = packets[Symbol.asyncIterator]();

        // Read initial request
        const initialRequest = await iter.next();
        expect(initialRequest.done).toBe(false);
        expect(initialRequest.value.type).toBe("data");

        // Send ref advertisement
        await serverWrite(encodePacket(`${COMMIT_A} refs/heads/main\0\n`));
        await serverWrite(encodeFlush());

        // Read client's want packets after discovery
        const received: string[] = [];
        for await (const packet of { [Symbol.asyncIterator]: () => iter }) {
          if (packet.type === "flush") break;
          if (packet.type === "data" && packet.data) {
            received.push(new TextDecoder().decode(packet.data));
          }
        }

        expect(received.length).toBeGreaterThan(0);
        expect(received.some((r) => r.includes("want"))).toBe(true);

        serverPort.postMessage(null); // Close signal
      })();

      // Client: discover refs first (required before send)
      await client.discoverRefs();

      // Client: send want packet
      await client.send(
        (async function* () {
          yield { type: "data" as const, data: new TextEncoder().encode(`want ${COMMIT_A}\n`) };
          yield { type: "flush" as const };
        })(),
      );

      await serverHandle;
      await client.close();
    });
  });
});

// =============================================================================
// Server Tests
// =============================================================================

describe("GitSocketServer", () => {
  describe("handleGitSocketConnection", () => {
    it("should handle valid upload-pack request", async () => {
      const [clientPort, serverPort] = createMessagePortPair();

      const repository = createMockRepository();
      const options: GitSocketServerOptions = {
        async resolveRepository(path) {
          if (path === "/repo.git") return repository;
          return null;
        },
      };

      // Start server handler
      const serverPromise = handleGitSocketConnection(serverPort, options);

      // Client: send request with full protocol flow
      const clientInput = createMessagePortReader(clientPort);
      const clientWrite = createMessagePortWriter(clientPort);

      const clientHandle = (async () => {
        // Send initial request
        await clientWrite(encodePacket("git-upload-pack /repo.git\0host=localhost\0"));

        // Read ref advertisement (until flush)
        const packets = pktLineReader(clientInput);
        const received: string[] = [];
        let foundFlush = false;

        for await (const packet of packets) {
          if (packet.type === "flush") {
            foundFlush = true;
            break;
          }
          if (packet.type === "data" && packet.data) {
            received.push(new TextDecoder().decode(packet.data));
          }
        }

        expect(foundFlush).toBe(true);
        expect(received.some((r) => r.includes(COMMIT_A))).toBe(true);
        expect(received.some((r) => r.includes("refs/heads/main"))).toBe(true);

        // Send empty request (just flush - no wants)
        await clientWrite(encodeFlush());
        clientPort.postMessage(null); // Close signal
      })();

      await Promise.all([serverPromise, clientHandle]);
    });

    it("should handle valid receive-pack request", async () => {
      const [clientPort, serverPort] = createMessagePortPair();

      const repository = createMockRepository();
      const options: GitSocketServerOptions = {
        async resolveRepository() {
          return repository;
        },
      };

      const serverPromise = handleGitSocketConnection(serverPort, options);

      const clientInput = createMessagePortReader(clientPort);
      const clientWrite = createMessagePortWriter(clientPort);

      const clientHandle = (async () => {
        await clientWrite(encodePacket("git-receive-pack /repo.git\0host=localhost\0"));

        // Read ref advertisement (until flush)
        const packets = pktLineReader(clientInput);
        const received: string[] = [];
        let foundFlush = false;

        for await (const packet of packets) {
          if (packet.type === "flush") {
            foundFlush = true;
            break;
          }
          if (packet.type === "data" && packet.data) {
            received.push(new TextDecoder().decode(packet.data));
          }
        }

        expect(foundFlush).toBe(true);
        expect(received.some((r) => r.includes(COMMIT_A))).toBe(true);
        expect(received.some((r) => r.includes("refs/heads/main"))).toBe(true);

        // Send empty request (no updates)
        await clientWrite(encodeFlush());
        clientPort.postMessage(null); // Close signal
      })();

      await Promise.all([serverPromise, clientHandle]);
    });

    it("should reject invalid service", async () => {
      const [clientPort, serverPort] = createMessagePortPair();

      const options: GitSocketServerOptions = {
        async resolveRepository() {
          return createMockRepository();
        },
      };

      const serverPromise = handleGitSocketConnection(serverPort, options).catch(() => {
        // Expected to throw
      });

      const clientInput = createMessagePortReader(clientPort);
      const clientWrite = createMessagePortWriter(clientPort);

      const clientHandle = (async () => {
        await clientWrite(encodePacket("git-invalid-service /repo.git\0host=localhost\0"));

        const chunks: Uint8Array[] = [];
        for await (const chunk of clientInput) {
          chunks.push(chunk);
        }

        const response = concatBytes(chunks);
        const text = new TextDecoder().decode(response);
        expect(text).toContain("ERR");
        expect(text).toContain("Invalid service");
      })();

      await Promise.all([serverPromise, clientHandle]);
    });

    it("should return error for non-existent repository", async () => {
      const [clientPort, serverPort] = createMessagePortPair();

      const options: GitSocketServerOptions = {
        async resolveRepository() {
          return null;
        },
      };

      const serverPromise = handleGitSocketConnection(serverPort, options);

      const clientInput = createMessagePortReader(clientPort);
      const clientWrite = createMessagePortWriter(clientPort);

      const clientHandle = (async () => {
        await clientWrite(encodePacket("git-upload-pack /unknown.git\0host=localhost\0"));

        const chunks: Uint8Array[] = [];
        for await (const chunk of clientInput) {
          chunks.push(chunk);
        }

        const response = concatBytes(chunks);
        const text = new TextDecoder().decode(response);
        expect(text).toContain("ERR");
        expect(text).toContain("repository not found");
      })();

      await Promise.all([serverPromise, clientHandle]);
    });

    it("should call authenticate callback", async () => {
      const [clientPort, serverPort] = createMessagePortPair();

      let authenticateCalled = false;
      let authenticateHost = "";
      let authenticatePath = "";

      const options: GitSocketServerOptions = {
        async resolveRepository() {
          return createMockRepository();
        },
        async authenticate(host, path) {
          authenticateCalled = true;
          authenticateHost = host;
          authenticatePath = path;
          return true;
        },
      };

      const serverPromise = handleGitSocketConnection(serverPort, options);

      const clientInput = createMessagePortReader(clientPort);
      const clientWrite = createMessagePortWriter(clientPort);

      const clientHandle = (async () => {
        await clientWrite(encodePacket("git-upload-pack /repo.git\0host=myhost\0"));

        // Read ref advertisement (until flush)
        const packets = pktLineReader(clientInput);
        for await (const packet of packets) {
          if (packet.type === "flush") break;
        }

        // Send empty request
        await clientWrite(encodeFlush());
        clientPort.postMessage(null); // Close signal
      })();

      await Promise.all([serverPromise, clientHandle]);

      expect(authenticateCalled).toBe(true);
      expect(authenticateHost).toBe("myhost");
      expect(authenticatePath).toBe("/repo.git");
    });

    it("should reject when authentication fails", async () => {
      const [clientPort, serverPort] = createMessagePortPair();

      const options: GitSocketServerOptions = {
        async resolveRepository() {
          return createMockRepository();
        },
        async authenticate() {
          return false;
        },
      };

      const serverPromise = handleGitSocketConnection(serverPort, options);

      const clientInput = createMessagePortReader(clientPort);
      const clientWrite = createMessagePortWriter(clientPort);

      const clientHandle = (async () => {
        await clientWrite(encodePacket("git-upload-pack /repo.git\0host=localhost\0"));

        const chunks: Uint8Array[] = [];
        for await (const chunk of clientInput) {
          chunks.push(chunk);
        }

        const response = concatBytes(chunks);
        const text = new TextDecoder().decode(response);
        expect(text).toContain("ERR");
        expect(text).toContain("access denied");
      })();

      await Promise.all([serverPromise, clientHandle]);
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("GitSocket Integration", () => {
  it("should complete client-server ref discovery", async () => {
    const [clientPort, serverPort] = createMessagePortPair();

    const repository = createMockRepository({
      refs: [
        { name: "refs/heads/main", objectId: COMMIT_A },
        { name: "refs/heads/feature", objectId: COMMIT_B },
      ],
    });

    const serverOptions: GitSocketServerOptions = {
      async resolveRepository() {
        return repository;
      },
    };

    // Start server
    const serverPromise = handleGitSocketConnection(serverPort, serverOptions);

    // Create client
    const client = createGitSocketClient(clientPort, {
      path: "/repo.git",
      service: "git-upload-pack",
    });

    // Discover refs
    const advertisement = await client.discoverRefs();

    expect(advertisement.refs.size).toBe(2);
    expect(advertisement.refs.has("refs/heads/main")).toBe(true);
    expect(advertisement.refs.has("refs/heads/feature")).toBe(true);

    await client.close();
    await serverPromise;
  });

  it("should handle empty repository", async () => {
    const [clientPort, serverPort] = createMessagePortPair();

    const repository = createMockRepository({
      refs: [],
      head: null,
    });

    const serverOptions: GitSocketServerOptions = {
      async resolveRepository() {
        return repository;
      },
    };

    const serverPromise = handleGitSocketConnection(serverPort, serverOptions);

    const client = createGitSocketClient(clientPort, {
      path: "/empty.git",
    });

    const advertisement = await client.discoverRefs();

    // Empty repo should have no refs (zero-id capabilities line is filtered)
    expect(advertisement.refs.size).toBe(0);

    await client.close();
    await serverPromise;
  });

  it("should support receive-pack service", async () => {
    const [clientPort, serverPort] = createMessagePortPair();

    const repository = createMockRepository();

    const serverOptions: GitSocketServerOptions = {
      async resolveRepository() {
        return repository;
      },
    };

    const serverPromise = handleGitSocketConnection(serverPort, serverOptions);

    const client = createGitSocketClient(clientPort, {
      path: "/repo.git",
      service: "git-receive-pack",
    });

    const advertisement = await client.discoverRefs();
    expect(advertisement.refs.has("refs/heads/main")).toBe(true);

    await client.close();
    await serverPromise;
  });
});

// =============================================================================
// Helper Functions
// =============================================================================

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
