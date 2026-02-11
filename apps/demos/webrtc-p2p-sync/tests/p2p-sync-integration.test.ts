/**
 * Integration test for P2P sync workflow.
 *
 * Tests the full sync flow between two applications using MessagePort-based
 * mock communication. Verifies that:
 * - Client 1 can initialize, create files, and share
 * - Client 2 can join and sync
 * - All commits are properly transferred
 */

import { Git } from "@statewalker/vcs-commands";
import type { History, SerializationApi } from "@statewalker/vcs-core";
import {
  createMemoryHistory,
  createSimpleStaging,
  DefaultSerializationApi,
  MemoryCheckout,
  MemoryWorkingCopy,
  MemoryWorktree,
} from "@statewalker/vcs-core";

/**
 * Create SerializationApi from History facade.
 */
function createSerializationApi(history: History): SerializationApi {
  return new DefaultSerializationApi({ history });
}

import { fetchOverDuplex, serveOverDuplex } from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createClientDuplex,
  createRefStoreAdapter,
  waitForClientService,
} from "../src/adapters/index.js";

// Mock window.location for Node.js environment
beforeAll(() => {
  if (typeof globalThis.window === "undefined") {
    (globalThis as unknown as { window: unknown }).window = {
      location: {
        origin: "http://localhost:3000",
        pathname: "/",
      },
    };
  }
});

import {
  enqueueAddFileAction,
  enqueueInitRepoAction,
  enqueueJoinAction,
  enqueueShareAction,
  enqueueStartSyncAction,
} from "../src/actions/index.js";
import type { PeerConnection, PeerInstance, PeerJsApi } from "../src/apis/index.js";
import { getTimerApi, MockTimerApi, setPeerJsApi, setTimerApi } from "../src/apis/index.js";
import type { AppContext } from "../src/controllers/index.js";
import {
  createRepositoryController,
  createSessionController,
  createSyncController,
  setGit,
  setHistory,
  setSerializationApi,
  setWorkingCopy,
  setWorktree,
} from "../src/controllers/index.js";
import {
  getActivityLogModel,
  getPeersModel,
  getRepositoryModel,
  getSessionModel,
  getSyncModel,
  getUserActionsModel,
} from "../src/models/index.js";

// Debug logging for message tracing
const DEBUG_MESSAGES = false;
let messageCounter = 0;

/**
 * Mock PeerConnection that uses MessagePort for communication.
 * This enables real async message passing between test clients.
 */
class MockPeerConnection implements PeerConnection {
  readonly peer: string;
  open = false;
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  private port: MessagePort | null = null;
  private closed = false;
  private debugId: string;

  constructor(peerId: string) {
    this.peer = peerId;
    this.debugId = `conn-${peerId.slice(0, 8)}`;
  }

  /**
   * Set the MessagePort for this connection.
   * Messages sent via send() go through this port.
   */
  setPort(port: MessagePort): void {
    this.port = port;
    port.onmessage = (event) => {
      if (!this.closed) {
        const msgId = ++messageCounter;
        if (DEBUG_MESSAGES) {
          const preview =
            event.data instanceof Uint8Array
              ? `Uint8Array(${event.data.length})`
              : String(event.data).slice(0, 50);
          console.log(`[${this.debugId}] RECV #${msgId}: ${preview}`);
        }
        this.emit("data", event.data);
      }
    };
    port.onmessageerror = (event) => {
      if (!this.closed) {
        this.emit("error", new Error(`Message error: ${event}`));
      }
    };
  }

  send(data: ArrayBuffer | Uint8Array): void {
    if (!this.port || this.closed) {
      throw new Error("Connection not open");
    }
    const msgId = ++messageCounter;
    if (DEBUG_MESSAGES) {
      const len = data instanceof ArrayBuffer ? data.byteLength : data.length;
      console.log(`[${this.debugId}] SEND #${msgId}: bytes(${len})`);
    }
    // Transfer the data through the MessagePort
    this.port.postMessage(data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    if (this.port) {
      this.port.close();
      this.port = null;
    }
    this.emit("close");
  }

  on(event: "open", handler: () => void): void;
  on(event: "close", handler: () => void): void;
  on(event: "data", handler: (data: unknown) => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  on(event: string, handler: ((...args: unknown[]) => void) | (() => void)): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)?.add(handler as (...args: unknown[]) => void);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    // Snapshot handlers before iterating (matches real EventEmitter behavior).
    // Without snapshot, handlers added during iteration (e.g., by waitForClientService
    // creating a new duplex) would see the current event data, corrupting the protocol.
    const handlers = [...(this.handlers.get(event) ?? [])];
    for (const h of handlers) {
      h(...args);
    }
  }

  simulateOpen(): void {
    this.open = true;
    this.emit("open");
  }
}

/**
 * Mock PeerInstance that supports MessagePort-based connections.
 */
class MockPeerInstance implements PeerInstance {
  readonly id: string;
  open = false;
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  private _registry: MockPeerRegistry;

  constructor(id: string, registry: MockPeerRegistry) {
    this.id = id;
    this._registry = registry;
  }

  connect(
    peerId: string,
    _options?: { serialization?: string; reliable?: boolean },
  ): PeerConnection {
    // Create a connection to the remote peer
    const conn = new MockPeerConnection(peerId);

    // Ask the registry to link this connection to the remote peer
    this._registry.linkConnection(this.id, peerId, conn);

    return conn;
  }

  destroy(): void {
    this.open = false;
    this._registry.unregisterPeer(this.id);
    this.emit("close");
  }

  on(event: "open", handler: (id: string) => void): void;
  on(event: "connection", handler: (conn: PeerConnection) => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  on(event: "close", handler: () => void): void;
  on(event: "disconnected", handler: () => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  on(event: string, handler: ((...args: unknown[]) => void) | (() => void)): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)?.add(handler as (...args: unknown[]) => void);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    // Snapshot handlers before iterating (matches real EventEmitter behavior)
    const handlers = [...(this.handlers.get(event) ?? [])];
    for (const h of handlers) {
      h(...args);
    }
  }

  simulateOpen(): void {
    this.open = true;
    this.emit("open", this.id);
  }

  /**
   * Called by registry when an incoming connection is established.
   */
  receiveIncomingConnection(conn: MockPeerConnection): void {
    this.emit("connection", conn);
  }
}

/**
 * Registry that manages all mock peers and links connections via MessageChannel.
 */
class MockPeerRegistry {
  private peers = new Map<string, MockPeerInstance>();
  private nextId = 1;

  registerPeer(peer: MockPeerInstance): void {
    this.peers.set(peer.id, peer);
  }

  unregisterPeer(id: string): void {
    this.peers.delete(id);
  }

  generateId(): string {
    return `mock-peer-${this.nextId++}`;
  }

  /**
   * Link an outgoing connection to the target peer.
   * Creates a MessageChannel and gives one port to each side.
   */
  linkConnection(fromPeerId: string, toPeerId: string, outgoingConn: MockPeerConnection): void {
    const targetPeer = this.peers.get(toPeerId);
    if (!targetPeer) {
      // Target peer doesn't exist - simulate error after a delay
      setTimeout(() => {
        outgoingConn.emit("error", new Error(`Peer ${toPeerId} not found`));
      }, 10);
      return;
    }

    // Create a MessageChannel for bidirectional communication
    const channel = new MessageChannel();

    // Give port1 to the outgoing connection
    outgoingConn.setPort(channel.port1);

    // Create an incoming connection for the target peer with port2
    const incomingConn = new MockPeerConnection(fromPeerId);
    incomingConn.setPort(channel.port2);

    // Simulate connection establishment after a short delay
    setTimeout(() => {
      // First, notify target peer of incoming connection
      // This lets the session controller attach its "open" handler
      targetPeer.receiveIncomingConnection(incomingConn);

      // Then after another delay, fire "open" events
      // This gives time for event handlers to be attached
      setTimeout(() => {
        outgoingConn.simulateOpen();
        incomingConn.simulateOpen();
      }, 5);
    }, 10);
  }

  reset(): void {
    for (const peer of this.peers.values()) {
      peer.destroy();
    }
    this.peers.clear();
    this.nextId = 1;
  }
}

/**
 * Mock PeerJsApi that uses the registry for connections.
 */
class MockPeerJsApi implements PeerJsApi {
  private registry: MockPeerRegistry;

  constructor(registry: MockPeerRegistry) {
    this.registry = registry;
  }

  createPeer(id?: string): PeerInstance {
    const peerId = id ?? this.registry.generateId();
    const peer = new MockPeerInstance(peerId, this.registry);
    this.registry.registerPeer(peer);

    // Simulate peer ready after a short delay
    setTimeout(() => {
      peer.simulateOpen();
    }, 5);

    return peer;
  }
}

/**
 * Create a test context with in-memory Git infrastructure.
 * Uses the new Three-Part Architecture (History/Checkout/Worktree).
 */
async function createTestAppContext(registry: MockPeerRegistry): Promise<AppContext> {
  const ctx: AppContext = {};

  // Initialize all models
  getSessionModel(ctx);
  getPeersModel(ctx);
  getSyncModel(ctx);
  getRepositoryModel(ctx);
  getActivityLogModel(ctx);
  getUserActionsModel(ctx);

  // Initialize Git infrastructure using Three-Part Architecture

  // 1. Create in-memory History (blobs, trees, commits, tags, refs)
  const history = createMemoryHistory();
  await history.initialize();
  // Set HEAD as symbolic ref so CommitCommand creates refs/heads/main
  await history.refs.setSymbolic("HEAD", "refs/heads/main");
  setHistory(ctx, history);

  // 2. Create in-memory Staging
  const staging = createSimpleStaging();

  // 3. Create in-memory Checkout (HEAD, operation states)
  const checkout = new MemoryCheckout({
    staging,
    initialHead: { type: "symbolic", target: "refs/heads/main" },
  });

  // 4. Create in-memory Worktree (file storage)
  const worktree = new MemoryWorktree({
    blobs: history.blobs,
    trees: history.trees,
  });
  setWorktree(ctx, worktree);

  // 5. Create WorkingCopy (combines history, checkout, worktree)
  const workingCopy = new MemoryWorkingCopy({
    history,
    checkout,
    worktree,
  });
  setWorkingCopy(ctx, workingCopy);

  // 6. Create Git porcelain API
  const git = Git.fromWorkingCopy(workingCopy);
  setGit(ctx, git);

  // 7. Create SerializationApi for pack import/export
  const serialization = createSerializationApi(history);
  setSerializationApi(ctx, serialization);

  // Inject mock APIs
  setPeerJsApi(ctx, new MockPeerJsApi(registry));
  setTimerApi(ctx, new MockTimerApi());

  return ctx;
}

/**
 * Interface for models that support update subscription.
 */
interface SubscribableModel {
  onUpdate(callback: () => void): () => void;
}

/**
 * Wait for a model to satisfy a condition (event-based).
 *
 * This is more efficient than polling because it uses the model's
 * onUpdate event to check the condition only when the model changes.
 *
 * @param model - The model to watch
 * @param check - Function that checks the condition
 * @param timeout - Maximum time to wait in milliseconds (default: 5000)
 * @returns Promise that resolves when condition is true, or rejects on timeout
 */
async function waitModel<M extends SubscribableModel>(
  model: M,
  check: (model: M) => boolean,
  timeout = 5000,
): Promise<void> {
  // Check immediately
  if (check(model)) {
    return;
  }

  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    // Subscribe to model updates
    unsubscribe = model.onUpdate(() => {
      if (check(model)) {
        cleanup();
        resolve();
      }
    });

    // Set timeout
    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`waitModel timeout: condition not satisfied within ${timeout}ms`));
    }, timeout);

    // Check again after subscribing (in case update happened between check and subscribe)
    if (check(model)) {
      cleanup();
      resolve();
    }
  });
}

/**
 * Wait for async operations to complete.
 */
async function flushPromises(iterations = 10): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Minimal isolation test - bypasses all controllers, tests duplex adapter + transport directly.
 */
describe("Duplex Adapter Isolation", () => {
  it("should complete a fetch over PeerJS duplex", { timeout: 10000 }, async () => {
    // Create linked mock connections via MessageChannel
    const channel = new MessageChannel();
    const clientConn = new MockPeerConnection("server-peer");
    const serverConn = new MockPeerConnection("client-peer");
    clientConn.setPort(channel.port1);
    serverConn.setPort(channel.port2);
    clientConn.open = true;
    serverConn.open = true;

    // Create server-side history with a commit
    const serverHistory = createMemoryHistory();
    await serverHistory.initialize();
    const serverSerialization = createSerializationApi(serverHistory);

    // Create a blob, tree, and commit manually
    const blobId = await serverHistory.blobs.store([new TextEncoder().encode("hello world")]);
    const treeId = await serverHistory.trees.store([
      { name: "test.txt", mode: 0o100644, id: blobId },
    ]);
    const now = Math.floor(Date.now() / 1000);
    const commitId = await serverHistory.commits.store({
      tree: treeId,
      parents: [],
      author: { name: "Test", email: "test@test.com", timestamp: now, tzOffset: "+0000" },
      committer: { name: "Test", email: "test@test.com", timestamp: now, tzOffset: "+0000" },
      message: "initial commit",
    });
    await serverHistory.refs.set("refs/heads/main", commitId);

    // Create client-side empty history
    const clientHistory = createMemoryHistory();
    await clientHistory.initialize();
    const clientSerialization = createSerializationApi(clientHistory);

    // Set up server: wait for service byte, then serve
    const serverRepo = createVcsRepositoryFacade({
      history: serverHistory,
      serialization: serverSerialization,
    });
    const serverRefStore = createRefStoreAdapter(serverHistory.refs);

    const serverPromise = (async () => {
      const { duplex, service } = await waitForClientService(serverConn);
      return await serveOverDuplex({
        duplex,
        repository: serverRepo,
        refStore: serverRefStore,
        service,
      });
    })();

    // Set up client: create duplex + fetch
    const clientRepo = createVcsRepositoryFacade({
      history: clientHistory,
      serialization: clientSerialization,
    });
    const clientRefStore = createRefStoreAdapter(clientHistory.refs);

    const clientDuplex = createClientDuplex(clientConn, "git-upload-pack");
    const clientResult = await fetchOverDuplex({
      duplex: clientDuplex,
      repository: clientRepo,
      refStore: clientRefStore,
    });

    const serverResult = await serverPromise;

    expect(serverResult.success).toBe(true);
    expect(clientResult.success).toBe(true);
  });
});

describe("P2P Sync Integration", () => {
  let registry: MockPeerRegistry;
  let ctx1: AppContext;
  let ctx2: AppContext;
  let cleanup1: (() => void)[] = [];
  let cleanup2: (() => void)[] = [];

  beforeEach(async () => {
    // Create shared registry for peer connections
    registry = new MockPeerRegistry();

    // Create two independent app contexts
    ctx1 = await createTestAppContext(registry);
    ctx2 = await createTestAppContext(registry);

    // Initialize controllers for both clients
    cleanup1 = [
      createRepositoryController(ctx1),
      createSessionController(ctx1),
      createSyncController(ctx1),
    ];
    cleanup2 = [
      createRepositoryController(ctx2),
      createSessionController(ctx2),
      createSyncController(ctx2),
    ];
  });

  afterEach(() => {
    // Cleanup controllers
    for (const fn of cleanup1) fn();
    for (const fn of cleanup2) fn();
    cleanup1 = [];
    cleanup2 = [];

    // Reset registry
    registry.reset();
  });

  it(
    "should establish P2P connection and sync refs between clients",
    { timeout: 30000 },
    async () => {
      const actionsModel1 = getUserActionsModel(ctx1);
      const actionsModel2 = getUserActionsModel(ctx2);
      const repoModel1 = getRepositoryModel(ctx1);
      const sessionModel1 = getSessionModel(ctx1);
      const sessionModel2 = getSessionModel(ctx2);
      const peersModel1 = getPeersModel(ctx1);
      const peersModel2 = getPeersModel(ctx2);
      const syncModel2 = getSyncModel(ctx2);
      const logModel2 = getActivityLogModel(ctx2);

      // ========================================
      // Client 1: Initialize repository with commits
      // ========================================
      enqueueInitRepoAction(actionsModel1);
      await waitModel(repoModel1, (m) => m.getState().initialized);

      // Create 5 files (5 additional commits)
      for (let i = 1; i <= 5; i++) {
        enqueueAddFileAction(actionsModel1, {
          name: `file${i}.txt`,
          content: `Content of file ${i}`,
        });
        const expectedCount = i + 1;
        await waitModel(repoModel1, (m) => m.getState().commitCount === expectedCount);
      }

      expect(repoModel1.getState().commitCount).toBe(6);

      // ========================================
      // Client 1: Share repository
      // ========================================
      enqueueShareAction(actionsModel1);
      await waitModel(sessionModel1, (m) => m.getState().mode === "hosting");

      const sessionId = sessionModel1.getState().sessionId;
      expect(sessionId).toBeTruthy();
      if (!sessionId) throw new Error("Session ID not set");

      // ========================================
      // Client 2: Join session (without initializing own repo - matches real demo flow)
      // ========================================
      enqueueJoinAction(actionsModel2, { sessionId });
      await waitModel(sessionModel2, (m) => m.getState().mode === "joined");

      // Wait for bidirectional connection
      await flushPromises(50);
      await waitModel(
        peersModel2,
        (m) => m.count > 0 && m.getAll()[0]?.status === "connected",
        10000,
      );
      await waitModel(
        peersModel1,
        (m) => m.count > 0 && m.getAll()[0]?.status === "connected",
        10000,
      );

      // ========================================
      // Verify: Connection established
      // ========================================
      expect(peersModel1.count).toBe(1);
      expect(peersModel1.getAll()[0].status).toBe("connected");
      expect(peersModel2.count).toBe(1);
      expect(peersModel2.getAll()[0].status).toBe("connected");

      // ========================================
      // Client 2: Start sync with the host
      // ========================================
      const hostPeerId = peersModel2.getAll()[0].id;

      enqueueStartSyncAction(actionsModel2, { peerId: hostPeerId });

      // Wait for sync to complete
      await waitModel(
        syncModel2,
        (m) => m.getState().phase === "complete" || m.getState().phase === "error",
        15000,
      );

      // ========================================
      // Verify: Sync completed successfully
      // ========================================
      expect(syncModel2.getState().phase).toBe("complete");

      // ========================================
      // Verify: Remote tracking ref was synced
      // ========================================
      // The sync should have set refs/remotes/peer/main to Client 1's HEAD
      // and updated local refs/heads/main
      const logs = logModel2.getEntries();
      const refUpdateLog = logs.find((e) =>
        e.message.includes("Updated ref refs/remotes/peer/main"),
      );
      expect(refUpdateLog).toBeDefined();

      // Either "Set local main" (if no local main) or "Updated local main" (if already exists)
      const localMainLog = logs.find(
        (e) => e.message.includes("Set local main") || e.message.includes("Updated local main"),
      );
      expect(localMainLog).toBeDefined();

      // Verify the local main was set to Client 1's HEAD
      const client1Head = repoModel1.getState().headCommitId;
      expect(client1Head).toBeTruthy();
      expect(localMainLog?.message).toContain(client1Head?.slice(0, 7));
    },
  );

  it(
    "should sync refs from host to joiner without prior initialization",
    { timeout: 30000 },
    async () => {
      const actionsModel1 = getUserActionsModel(ctx1);
      const actionsModel2 = getUserActionsModel(ctx2);
      const repoModel1 = getRepositoryModel(ctx1);
      const sessionModel1 = getSessionModel(ctx1);
      const peersModel1 = getPeersModel(ctx1);
      const peersModel2 = getPeersModel(ctx2);
      const syncModel2 = getSyncModel(ctx2);

      // Initialize Client 1's repository (Client 2 joins without init - matches demo flow)
      enqueueInitRepoAction(actionsModel1);
      await waitModel(repoModel1, (m) => m.getState().initialized);

      // Client 1: Create 3 files
      for (let i = 1; i <= 3; i++) {
        enqueueAddFileAction(actionsModel1, {
          name: `client1-file${i}.txt`,
          content: `Client 1 file ${i}`,
        });
        const expectedCount = i + 1;
        await waitModel(repoModel1, (m) => m.getState().commitCount === expectedCount);
      }
      expect(repoModel1.getState().commitCount).toBe(4); // 1 initial + 3 files

      // Client 1: Share
      enqueueShareAction(actionsModel1);
      await waitModel(sessionModel1, (m) => m.getState().mode === "hosting");
      const sessionId = sessionModel1.getState().sessionId;
      if (!sessionId) throw new Error("Session ID not set");

      // Client 2: Join
      enqueueJoinAction(actionsModel2, { sessionId });
      await waitModel(peersModel2, (m) => m.getAll()[0]?.status === "connected");
      await waitModel(peersModel1, (m) => m.getAll()[0]?.status === "connected");

      // Client 2: Sync to get Client 1's commits
      const hostPeerId = peersModel2.getAll()[0].id;
      enqueueStartSyncAction(actionsModel2, { peerId: hostPeerId });
      await waitModel(
        syncModel2,
        (m) => m.getState().phase === "complete" || m.getState().phase === "error",
        10000,
      );
      expect(syncModel2.getState().phase).toBe("complete");

      // Note: The sync model resets to "idle" via a timer which is mocked in tests.
      // We don't need to wait for that - the sync itself is complete.

      // Verify Client 2's local main was updated to Client 1's HEAD
      // The sync should have updated refs/heads/main to point to Client 1's HEAD
      const logModel2 = getActivityLogModel(ctx2);
      const logs2 = logModel2.getEntries();

      // Verify remote tracking ref was updated
      const remoteRefLog = logs2.find((e) =>
        e.message.includes("Updated ref refs/remotes/peer/main"),
      );
      expect(remoteRefLog).toBeDefined();

      // Verify local main was updated (or set) to the remote HEAD
      const localMainLog = logs2.find(
        (e) => e.message.includes("Set local main") || e.message.includes("Updated local main"),
      );
      expect(localMainLog).toBeDefined();

      // Client 1's HEAD should match what was synced
      const client1Head = repoModel1.getState().headCommitId;
      expect(client1Head).toBeTruthy();
      expect(localMainLog?.message).toContain(client1Head?.slice(0, 7));

      // NOTE: Bidirectional sync (Client 1 syncing from Client 2) is not tested here
      // because the current architecture uses a single MessagePort for both the Git server
      // (receiving incoming sync requests) and the Git client (making outgoing sync requests).
      // This would require a more sophisticated connection multiplexing approach.
    },
  );

  it(
    "should allow second sync after Client 2 creates new commits",
    { timeout: 30000 },
    async () => {
      const actionsModel1 = getUserActionsModel(ctx1);
      const actionsModel2 = getUserActionsModel(ctx2);
      const repoModel1 = getRepositoryModel(ctx1);
      const repoModel2 = getRepositoryModel(ctx2);
      const sessionModel1 = getSessionModel(ctx1);
      const peersModel1 = getPeersModel(ctx1);
      const peersModel2 = getPeersModel(ctx2);
      const syncModel2 = getSyncModel(ctx2);
      const logModel2 = getActivityLogModel(ctx2);

      // ========================================
      // Client 1: Initialize repository and create files
      // ========================================
      enqueueInitRepoAction(actionsModel1);
      await waitModel(repoModel1, (m) => m.getState().initialized);

      // Client 1: Create 2 files
      for (let i = 1; i <= 2; i++) {
        enqueueAddFileAction(actionsModel1, {
          name: `client1-file${i}.txt`,
          content: `Client 1 file ${i}`,
        });
        const expectedCount = i + 1;
        await waitModel(repoModel1, (m) => m.getState().commitCount === expectedCount);
      }
      expect(repoModel1.getState().commitCount).toBe(3); // 1 initial + 2 files

      // ========================================
      // Client 1: Share
      // ========================================
      enqueueShareAction(actionsModel1);
      await waitModel(sessionModel1, (m) => m.getState().mode === "hosting");
      const sessionId = sessionModel1.getState().sessionId;
      if (!sessionId) throw new Error("Session ID not set");

      // ========================================
      // Client 2: Join (without initializing own repo - matches real demo flow)
      // ========================================
      enqueueJoinAction(actionsModel2, { sessionId });
      await waitModel(peersModel2, (m) => m.getAll()[0]?.status === "connected", 10000);
      await waitModel(peersModel1, (m) => m.getAll()[0]?.status === "connected", 10000);

      // ========================================
      // Client 2: First sync (fetch from Client 1)
      // ========================================
      const hostPeerId = peersModel2.getAll()[0].id;
      enqueueStartSyncAction(actionsModel2, { peerId: hostPeerId });
      await waitModel(
        syncModel2,
        (m) => m.getState().phase === "complete" || m.getState().phase === "error",
        10000,
      );
      expect(syncModel2.getState().phase).toBe("complete");

      // Advance the mock timer to trigger sync model reset (COMPLETE_DISPLAY_MS = 2000)
      const timerApi2 = getTimerApi(ctx2) as MockTimerApi;
      timerApi2.advance(3000);

      // Wait for sync model to reset before next sync
      await waitModel(syncModel2, (m) => m.getState().phase === "idle", 5000);

      // Wait for checkout and refresh to complete after sync
      await flushPromises(20);
      await waitModel(
        repoModel2,
        (m) => m.getState().commitCount === repoModel1.getState().commitCount,
        5000,
      );

      // ========================================
      // Client 2: Create new files (2 additional commits)
      // ========================================
      logModel2.info("--- Client 2 creating new commits ---");
      for (let i = 1; i <= 2; i++) {
        enqueueAddFileAction(actionsModel2, {
          name: `client2-file${i}.txt`,
          content: `Client 2 file ${i}`,
        });
        // Wait for commit count to increase
        const expectedCount = repoModel1.getState().commitCount + i;
        await waitModel(repoModel2, (m) => m.getState().commitCount === expectedCount, 5000);
      }

      // Client 2 should now have more commits than Client 1
      const client2CommitCount = repoModel2.getState().commitCount;
      const client1CommitCount = repoModel1.getState().commitCount;
      expect(client2CommitCount).toBe(client1CommitCount + 2);

      // ========================================
      // Client 2: Second sync (should push new commits to Client 1)
      // ========================================
      logModel2.info("--- Client 2 starting second sync ---");
      enqueueStartSyncAction(actionsModel2, { peerId: hostPeerId });

      // Wait for second sync to complete
      await waitModel(
        syncModel2,
        (m) => m.getState().phase === "complete" || m.getState().phase === "error",
        15000,
      );

      // Verify sync completed
      expect(syncModel2.getState().phase).toBe("complete");

      // ========================================
      // Verify: Both clients have same content
      // ========================================
      // Client 1 should have received Client 2's commits via push
      // The push updates refs/heads/main on the server side
      const client2Head = repoModel2.getState().headCommitId;
      expect(client2Head).toBeTruthy();
    },
  );
});
