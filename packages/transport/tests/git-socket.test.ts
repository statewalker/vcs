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

        // Read the error response
        const packets = pktLineReader(clientInput);
        const errorPacket = await packets.next();
        expect(errorPacket.done).toBe(false);
        expect(errorPacket.value?.data).toBeDefined();
        const text = new TextDecoder().decode(errorPacket.value?.data);
        expect(text).toContain("ERR");
        expect(text).toContain("repository not found");

        // Send close signal
        clientPort.postMessage(null);
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

        // Read the error response
        const packets = pktLineReader(clientInput);
        const errorPacket = await packets.next();
        expect(errorPacket.done).toBe(false);
        expect(errorPacket.value?.data).toBeDefined();
        const text = new TextDecoder().decode(errorPacket.value?.data);
        expect(text).toContain("ERR");
        expect(text).toContain("access denied");

        // Send close signal
        clientPort.postMessage(null);
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

    // Create client (ownsPort: true since this test owns the port)
    const client = createGitSocketClient(clientPort, {
      path: "/repo.git",
      service: "git-upload-pack",
      ownsPort: true,
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
      ownsPort: true,
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
      ownsPort: true,
    });

    const advertisement = await client.discoverRefs();
    expect(advertisement.refs.has("refs/heads/main")).toBe(true);

    await client.close();
    await serverPromise;
  });

  it("should transfer pack data when client has no local commits", async () => {
    const [clientPort, serverPort] = createMessagePortPair();

    // Create a repository with objects
    const objects = new Map<string, { type: ObjectTypeCode; content: Uint8Array }>();
    objects.set(COMMIT_A, {
      type: OBJ_COMMIT,
      content: new TextEncoder().encode("tree 0000000000000000000000000000000000000000\nauthor Test <test@test.com> 1234567890 +0000\ncommitter Test <test@test.com> 1234567890 +0000\n\nInitial commit\n"),
    });

    const debugLog: string[] = [];
    const repository: RepositoryAccess = {
      async *listRefs(): AsyncIterable<RefInfo> {
        debugLog.push("listRefs called");
        yield { name: "refs/heads/main", objectId: COMMIT_A };
      },
      async getHead(): Promise<HeadInfo | null> {
        return { target: "refs/heads/main" };
      },
      async hasObject(id: ObjectId): Promise<boolean> {
        debugLog.push(`hasObject: ${id}`);
        return objects.has(id);
      },
      async getObjectInfo(id: ObjectId): Promise<ObjectInfo | null> {
        const obj = objects.get(id);
        if (!obj) return null;
        return { type: obj.type, size: obj.content.length };
      },
      async *loadObject(id: ObjectId): AsyncIterable<Uint8Array> {
        const obj = objects.get(id);
        if (obj) yield obj.content;
      },
      async storeObject(): Promise<ObjectId> {
        return "new".repeat(10).slice(0, 40);
      },
      async updateRef(): Promise<boolean> {
        return true;
      },
      async *walkObjects(wants: ObjectId[], haves: ObjectId[]): AsyncIterable<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
        debugLog.push(`walkObjects: wants=${wants.length}, haves=${haves.length}`);
        const haveSet = new Set(haves);
        for (const wantId of wants) {
          if (!haveSet.has(wantId)) {
            const obj = objects.get(wantId);
            if (obj) {
              debugLog.push(`walkObjects yielding: ${wantId}`);
              yield { id: wantId, ...obj };
            }
          }
        }
      },
    };

    const serverOptions: GitSocketServerOptions = {
      async resolveRepository() {
        return repository;
      },
      logger: {
        debug: (...args: unknown[]) => debugLog.push(`[server] ${args.join(" ")}`),
        error: (...args: unknown[]) => debugLog.push(`[server error] ${args.join(" ")}`),
      },
    };

    // Create a logging wrapper for the server port to see what data is written
    const serverWriteLog: string[] = [];
    const originalPostMessage = serverPort.postMessage.bind(serverPort);
    (serverPort as { postMessage: (data: unknown, transfer?: unknown) => void }).postMessage = (
      data: unknown,
      transfer?: unknown,
    ) => {
      if (data === null) {
        serverWriteLog.push("null (close signal)");
      } else if (data instanceof Uint8Array) {
        const preview = new TextDecoder().decode(data.slice(0, Math.min(40, data.length)));
        serverWriteLog.push(`bytes(${data.length}): "${preview.replace(/\n/g, "\\n")}"`);
      } else {
        serverWriteLog.push(`unknown: ${typeof data}`);
      }
      if (transfer) {
        return originalPostMessage(data, transfer as Transferable[]);
      }
      return originalPostMessage(data);
    };

    // Start server
    const serverPromise = handleGitSocketConnection(serverPort, serverOptions).then(() => {
      console.log("Server write log:", serverWriteLog);
    });

    // Import needed modules
    const { generateFetchRequestPackets, buildFetchRequest } = await import(
      "../src/negotiation/fetch-negotiator.js"
    );

    // Create client connection
    const client = createGitSocketClient(clientPort, {
      path: "/repo.git",
      service: "git-upload-pack",
    });

    // Step 1: Discover refs
    const advertisement = await client.discoverRefs();
    console.log("Refs discovered:", [...advertisement.refs.keys()]);

    // Step 2: Build wants
    const wants: Uint8Array[] = [];
    for (const [refName, objectId] of advertisement.refs) {
      if (refName.startsWith("refs/heads/")) {
        wants.push(objectId);
      }
    }
    console.log("Wants count:", wants.length);

    // Step 3: Build and send request
    const request = buildFetchRequest(wants, advertisement.capabilities, [], {});
    console.log("Request capabilities:", request.capabilities.slice(0, 3), "...");

    await client.send(generateFetchRequestPackets(request));
    console.log("Request sent");

    // Step 4: Read response packets manually
    const packets = client.receive();
    const receivedPackets: string[] = [];
    let packDataChunks: Uint8Array[] = [];

    console.log("Starting to receive packets...");

    for await (const packet of packets) {
      if (packet.type === "flush") {
        console.log("Received flush packet");
        receivedPackets.push("flush");
        // After flush at the end, stop reading
        break;
      } else if (packet.type === "data" && packet.data) {
        const preview = new TextDecoder().decode(packet.data.slice(0, Math.min(30, packet.data.length)));
        const firstByte = packet.data[0];
        console.log(`Received data packet: len=${packet.data.length}, firstByte=${firstByte}, preview="${preview.replace(/\n/g, "\\n")}"`);
        receivedPackets.push(`data:${packet.data.length}`);

        // Check if it's sideband data (first byte is channel)
        if (firstByte === 1) {
          // SIDEBAND_DATA
          packDataChunks.push(packet.data.slice(1));
        } else if (firstByte === 2) {
          // SIDEBAND_PROGRESS - skip
        }
      }
    }

    console.log("Finished receiving. Packets:", receivedPackets);
    console.log("Pack data chunks:", packDataChunks.length);

    // Send close signal to server
    clientPort.postMessage(null);

    // Wait for server to complete
    await serverPromise;

    // Debug output
    console.log("Debug log:", debugLog);

    // Combine pack data
    const totalPackLen = packDataChunks.reduce((sum, c) => sum + c.length, 0);
    const packData = new Uint8Array(totalPackLen);
    let offset = 0;
    for (const chunk of packDataChunks) {
      packData.set(chunk, offset);
      offset += chunk.length;
    }

    console.log("Total pack data length:", packData.length);

    // Build result for assertions
    const result = {
      refs: new Map([["refs/remotes/origin/main", advertisement.refs.get("refs/heads/main")!]]),
      packData,
      bytesReceived: packData.length,
      isEmpty: false,
    };

    // Verify results
    expect(result.refs.has("refs/remotes/origin/main")).toBe(true);

    // Check if walkObjects was called
    expect(debugLog.some((log) => log.startsWith("walkObjects:"))).toBe(true);

    expect(result.packData.length).toBeGreaterThan(12); // At least pack header
    expect(result.bytesReceived).toBeGreaterThan(0);

    // Verify pack header
    const packMagic = new TextDecoder().decode(result.packData.slice(0, 4));
    expect(packMagic).toBe("PACK");

    await client.close();
  });
});

// =============================================================================
// Multiple Operations Tests (Re-sync Scenario)
// =============================================================================

describe("GitSocket Multiple Operations", () => {
  it("should support multiple sequential fetch operations on same port", async () => {
    const [clientPort, serverPort] = createMessagePortPair();

    // Repository that tracks operations
    const operationLog: string[] = [];
    const repository = createMockRepository({
      refs: [
        { name: "refs/heads/main", objectId: COMMIT_A },
      ],
    });

    const serverOptions: GitSocketServerOptions = {
      async resolveRepository(path) {
        operationLog.push(`resolveRepository: ${path}`);
        return repository;
      },
      logger: {
        debug: (...args: unknown[]) => operationLog.push(`[server] ${args.join(" ")}`),
        error: (...args: unknown[]) => operationLog.push(`[server error] ${args.join(" ")}`),
      },
    };

    // Start server - server loop handles multiple requests
    const serverPromise = handleGitSocketConnection(serverPort, serverOptions);

    // === First fetch operation ===
    operationLog.push("=== Starting first fetch ===");

    const client1 = createGitSocketClient(clientPort, {
      path: "/repo.git",
      service: "git-upload-pack",
      ownsPort: false, // Don't close port, we'll reuse it
    });

    const refs1 = await client1.discoverRefs();
    operationLog.push(`First fetch: discovered ${refs1.refs.size} refs`);

    expect(refs1.refs.has("refs/heads/main")).toBe(true);
    expect(refs1.refs.get("refs/heads/main")).toBeDefined();

    // Clean up client reader without closing port
    await client1.close();
    operationLog.push("First fetch: client closed");

    // Small delay to let server process
    await new Promise(r => setTimeout(r, 10));

    // === Second fetch operation ===
    operationLog.push("=== Starting second fetch ===");

    const client2 = createGitSocketClient(clientPort, {
      path: "/repo.git",
      service: "git-upload-pack",
      ownsPort: false,
    });

    // This is where it gets stuck in the bug scenario
    const refs2Promise = Promise.race([
      client2.discoverRefs(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Second fetch timed out")), 3000)
      ),
    ]);

    const refs2 = await refs2Promise;
    operationLog.push(`Second fetch: discovered ${refs2.refs.size} refs`);

    expect(refs2.refs.has("refs/heads/main")).toBe(true);

    // Clean up
    await client2.close();
    operationLog.push("Second fetch: client closed");

    // Close the connection
    clientPort.postMessage(null);

    await serverPromise;

    // Verify both operations completed
    console.log("Operation log:", operationLog);
    expect(operationLog.filter(l => l.includes("resolveRepository")).length).toBe(2);
  });

  it("should support fetch followed by push on same port", async () => {
    const [clientPort, serverPort] = createMessagePortPair();

    const operationLog: string[] = [];
    const repository = createMockRepository({
      refs: [
        { name: "refs/heads/main", objectId: COMMIT_A },
      ],
    });

    const serverOptions: GitSocketServerOptions = {
      async resolveRepository(path) {
        operationLog.push(`resolveRepository: ${path}`);
        return repository;
      },
      logger: {
        debug: (...args: unknown[]) => operationLog.push(`[server] ${args.join(" ")}`),
        error: (...args: unknown[]) => operationLog.push(`[server error] ${args.join(" ")}`),
      },
    };

    const serverPromise = handleGitSocketConnection(serverPort, serverOptions);

    // === Fetch operation (git-upload-pack) ===
    operationLog.push("=== Starting fetch ===");

    const fetchClient = createGitSocketClient(clientPort, {
      path: "/repo.git",
      service: "git-upload-pack",
      ownsPort: false,
    });

    const fetchRefs = await fetchClient.discoverRefs();
    operationLog.push(`Fetch: discovered ${fetchRefs.refs.size} refs`);
    expect(fetchRefs.refs.has("refs/heads/main")).toBe(true);

    await fetchClient.close();
    operationLog.push("Fetch: client closed");

    await new Promise(r => setTimeout(r, 10));

    // === Push operation (git-receive-pack) ===
    operationLog.push("=== Starting push ===");

    const pushClient = createGitSocketClient(clientPort, {
      path: "/repo.git",
      service: "git-receive-pack",
      ownsPort: false,
    });

    // This should discover refs for receive-pack
    const pushRefsPromise = Promise.race([
      pushClient.discoverRefs(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Push discovery timed out")), 3000)
      ),
    ]);

    const pushRefs = await pushRefsPromise;
    operationLog.push(`Push: discovered ${pushRefs.refs.size} refs`);
    expect(pushRefs.refs.has("refs/heads/main")).toBe(true);

    await pushClient.close();
    operationLog.push("Push: client closed");

    // Close connection
    clientPort.postMessage(null);

    await serverPromise;

    console.log("Operation log:", operationLog);
    expect(operationLog.filter(l => l.includes("resolveRepository")).length).toBe(2);
  });

  it("should handle three sequential operations", async () => {
    const [clientPort, serverPort] = createMessagePortPair();

    const operationCount = { value: 0 };
    const repository = createMockRepository();

    const serverOptions: GitSocketServerOptions = {
      async resolveRepository() {
        operationCount.value++;
        return repository;
      },
    };

    const serverPromise = handleGitSocketConnection(serverPort, serverOptions);

    // Operation 1
    const client1 = createGitSocketClient(clientPort, {
      path: "/repo.git",
      service: "git-upload-pack",
      ownsPort: false,
    });
    await client1.discoverRefs();
    await client1.close();
    await new Promise(r => setTimeout(r, 10));

    // Operation 2
    const client2 = createGitSocketClient(clientPort, {
      path: "/repo.git",
      service: "git-receive-pack",
      ownsPort: false,
    });
    const refs2Promise = Promise.race([
      client2.discoverRefs(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Operation 2 timed out")), 3000)
      ),
    ]);
    await refs2Promise;
    await client2.close();
    await new Promise(r => setTimeout(r, 10));

    // Operation 3
    const client3 = createGitSocketClient(clientPort, {
      path: "/repo.git",
      service: "git-upload-pack",
      ownsPort: false,
    });
    const refs3Promise = Promise.race([
      client3.discoverRefs(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Operation 3 timed out")), 3000)
      ),
    ]);
    await refs3Promise;
    await client3.close();

    // Close connection
    clientPort.postMessage(null);
    await serverPromise;

    expect(operationCount.value).toBe(3);
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
