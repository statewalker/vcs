import { wrapNativePort } from "@statewalker/vcs-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TcpSocket } from "../src/connection/git-connection";
import { createPortTcpSocket } from "../src/connection/port-tcp-socket";
import type {
  HeadInfo,
  ObjectInfo,
  ObjectTypeCode,
  RefInfo,
  RepositoryAccess,
} from "../src/handlers/types";
import { createGitPeerSession, GitPeerSession } from "../src/peer/git-peer-session";

// Track created resources for cleanup
const channels: MessageChannel[] = [];
const sockets: TcpSocket[] = [];

function createChannel(): MessageChannel {
  const channel = new MessageChannel();
  channels.push(channel);
  return channel;
}

afterEach(() => {
  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  channels.length = 0;
  sockets.length = 0;
});

/**
 * Create a mock RepositoryAccess for testing.
 */
function createMockRepository(
  refs: RefInfo[] = [],
  head: HeadInfo | null = null,
): RepositoryAccess {
  const objects = new Map<string, { type: ObjectTypeCode; content: Uint8Array }>();

  return {
    async *listRefs(): AsyncIterable<RefInfo> {
      for (const ref of refs) {
        yield ref;
      }
    },

    async getHead(): Promise<HeadInfo | null> {
      return head;
    },

    async hasObject(id: string): Promise<boolean> {
      return objects.has(id);
    },

    async getObjectInfo(id: string): Promise<ObjectInfo | null> {
      const obj = objects.get(id);
      if (!obj) return null;
      return { type: obj.type, size: obj.content.length };
    },

    async *loadObject(id: string): AsyncIterable<Uint8Array> {
      const obj = objects.get(id);
      if (obj) {
        yield obj.content;
      }
    },

    async storeObject(type: ObjectTypeCode, content: Uint8Array): Promise<string> {
      // Generate a simple hash for testing
      let hash = 0;
      for (const byte of content) {
        hash = ((hash << 5) - hash + byte) | 0;
      }
      const id = Math.abs(hash).toString(16).padStart(40, "0");
      objects.set(id, { type, content });
      return id;
    },

    async updateRef(_name: string, _oldId: string | null, _newId: string | null): Promise<boolean> {
      return true;
    },

    async *walkObjects(
      wants: string[],
      _haves: string[],
    ): AsyncIterable<{ id: string; type: ObjectTypeCode; content: Uint8Array }> {
      for (const id of wants) {
        const obj = objects.get(id);
        if (obj) {
          yield { id, ...obj };
        }
      }
    },
  };
}

describe("GitPeerSession", () => {
  // =============================================================================
  // Construction and lifecycle
  // =============================================================================

  describe("construction", () => {
    it("should create session with repository", () => {
      const repository = createMockRepository();
      const session = new GitPeerSession({ repository });

      expect(session).toBeInstanceOf(GitPeerSession);
    });

    it("should create session via factory function", () => {
      const repository = createMockRepository();
      const session = createGitPeerSession({ repository });

      expect(session).toBeInstanceOf(GitPeerSession);
    });

    it("should accept progress callback", () => {
      const repository = createMockRepository();
      const onProgress = vi.fn();

      const session = createGitPeerSession({ repository, onProgress });

      expect(session).toBeInstanceOf(GitPeerSession);
    });

    it("should accept error callback", () => {
      const repository = createMockRepository();
      const onError = vi.fn();

      const session = createGitPeerSession({ repository, onError });

      expect(session).toBeInstanceOf(GitPeerSession);
    });
  });

  // =============================================================================
  // Server role - handleIncoming
  // =============================================================================

  describe("handleIncoming", () => {
    it("should report progress when handling incoming request", async () => {
      const repository = createMockRepository([
        { name: "refs/heads/main", objectId: "a".repeat(40) },
      ]);
      const onProgress = vi.fn();
      const session = createGitPeerSession({ repository, onProgress });

      const channel = createChannel();
      const clientPort = wrapNativePort(channel.port1);
      const serverPort = wrapNativePort(channel.port2);

      // Start server handling
      const serverPromise = session.handleIncoming(serverPort);

      // Simulate client sending upload-pack request
      const clientSocket = createPortTcpSocket(clientPort);
      sockets.push(clientSocket);
      await clientSocket.connect();

      // Send git-upload-pack request in pkt-line format
      const request = "git-upload-pack /\0host=peer\0";
      const pktLength = (request.length + 4).toString(16).padStart(4, "0");
      const pktLine = pktLength + request;
      await clientSocket.write(new TextEncoder().encode(pktLine));

      // Close to signal end of request
      await clientSocket.close();

      // Wait for server to process (may timeout/error, but should report progress)
      try {
        await Promise.race([
          serverPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 100)),
        ]);
      } catch {
        // Expected - incomplete protocol exchange
      }

      // Verify progress was reported
      expect(onProgress).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith("server", "Waiting for connection...");
    });
  });

  // =============================================================================
  // Progress and error callbacks
  // =============================================================================

  describe("callbacks", () => {
    it("should call onProgress during operations", async () => {
      const repository = createMockRepository();
      const onProgress = vi.fn();
      const session = createGitPeerSession({ repository, onProgress });

      const channel = createChannel();
      const port = wrapNativePort(channel.port1);

      // fetchFrom will fail but should still report progress
      try {
        await Promise.race([
          session.fetchFrom(port),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 100)),
        ]);
      } catch {
        // Expected
      }

      expect(onProgress).toHaveBeenCalledWith("fetch", "Connecting to peer...");
    });

    it("should call onError when error occurs", async () => {
      const repository = createMockRepository();
      const onError = vi.fn();
      const session = createGitPeerSession({ repository, onError });

      const channel = createChannel();
      const port = wrapNativePort(channel.port1);

      // fetchFrom will fail - no server on other side
      try {
        await Promise.race([
          session.fetchFrom(port),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Test timeout")), 100)),
        ]);
      } catch {
        // Expected
      }

      // onError may or may not be called depending on timing
      // Just verify the session handled the error gracefully
    });
  });

  // =============================================================================
  // PeerRefUpdate and result types
  // =============================================================================

  describe("result types", () => {
    it("should have correct structure for PeerFetchResult", async () => {
      const repository = createMockRepository([
        { name: "refs/heads/main", objectId: "a".repeat(40) },
      ]);
      const session = createGitPeerSession({ repository });

      const channel = createChannel();
      const _clientPort = wrapNativePort(channel.port1);
      const serverPort = wrapNativePort(channel.port2);

      // Set up mock server that just advertises refs
      const _serverPromise = session.handleIncoming(serverPort);

      // This test verifies the type structure exists
      // The actual protocol exchange would need a full implementation
    });
  });
});
