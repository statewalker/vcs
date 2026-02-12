/**
 * Integration test for P2P sync workflow.
 *
 * Tests the full sync flow between two applications using MemoryConnectionProvider
 * (no PeerJS mocking). Verifies that:
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

function createSerializationApi(history: History): SerializationApi {
  return new DefaultSerializationApi({ history });
}

import { fetchOverDuplex, serveOverDuplex } from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMessagePortClientDuplex,
  createRefStoreAdapter,
  waitForMessagePortClientService,
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
import { getTimerApi, MockTimerApi, setTimerApi } from "../src/apis/index.js";
import {
  MemoryConnectionProvider,
  MemoryPeerRegistry,
} from "../src/apis/memory-connection-provider.js";
import type { AppContext } from "../src/controllers/index.js";
import {
  createRepositoryController,
  createSessionController,
  createSyncController,
  setConnectionProvider,
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

/**
 * Create a test context with in-memory Git infrastructure.
 * Uses MemoryConnectionProvider instead of mock PeerJS infrastructure.
 */
async function createTestAppContext(registry: MemoryPeerRegistry): Promise<AppContext> {
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

  // Inject memory connection provider (replaces MockPeerJsApi)
  setConnectionProvider(ctx, new MemoryConnectionProvider(registry));
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
 */
async function waitModel<M extends SubscribableModel>(
  model: M,
  check: (model: M) => boolean,
  timeout = 5000,
): Promise<void> {
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

    unsubscribe = model.onUpdate(() => {
      if (check(model)) {
        cleanup();
        resolve();
      }
    });

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`waitModel timeout: condition not satisfied within ${timeout}ms`));
    }, timeout);

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
  it("should complete a fetch over MessagePort duplex", { timeout: 10000 }, async () => {
    // Create linked MessagePorts directly (no mocks!)
    const channel = new MessageChannel();
    const clientPort = channel.port1;
    const serverPort = channel.port2;

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
      const { duplex, service } = await waitForMessagePortClientService(serverPort);
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

    const clientDuplex = createMessagePortClientDuplex(clientPort, "git-upload-pack");
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
  let registry: MemoryPeerRegistry;
  let ctx1: AppContext;
  let ctx2: AppContext;
  let cleanup1: (() => void)[] = [];
  let cleanup2: (() => void)[] = [];

  beforeEach(async () => {
    // Create shared registry for peer connections
    registry = new MemoryPeerRegistry();

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
      const logs = logModel2.getEntries();
      const refUpdateLog = logs.find((e) =>
        e.message.includes("Updated ref refs/remotes/peer/main"),
      );
      expect(refUpdateLog).toBeDefined();

      const localMainLog = logs.find(
        (e) => e.message.includes("Set local main") || e.message.includes("Updated local main"),
      );
      expect(localMainLog).toBeDefined();

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

      enqueueInitRepoAction(actionsModel1);
      await waitModel(repoModel1, (m) => m.getState().initialized);

      for (let i = 1; i <= 3; i++) {
        enqueueAddFileAction(actionsModel1, {
          name: `client1-file${i}.txt`,
          content: `Client 1 file ${i}`,
        });
        const expectedCount = i + 1;
        await waitModel(repoModel1, (m) => m.getState().commitCount === expectedCount);
      }
      expect(repoModel1.getState().commitCount).toBe(4);

      enqueueShareAction(actionsModel1);
      await waitModel(sessionModel1, (m) => m.getState().mode === "hosting");
      const sessionId = sessionModel1.getState().sessionId;
      if (!sessionId) throw new Error("Session ID not set");

      enqueueJoinAction(actionsModel2, { sessionId });
      await waitModel(peersModel2, (m) => m.getAll()[0]?.status === "connected");
      await waitModel(peersModel1, (m) => m.getAll()[0]?.status === "connected");

      const hostPeerId = peersModel2.getAll()[0].id;
      enqueueStartSyncAction(actionsModel2, { peerId: hostPeerId });
      await waitModel(
        syncModel2,
        (m) => m.getState().phase === "complete" || m.getState().phase === "error",
        10000,
      );
      expect(syncModel2.getState().phase).toBe("complete");

      const logModel2 = getActivityLogModel(ctx2);
      const logs2 = logModel2.getEntries();

      const remoteRefLog = logs2.find((e) =>
        e.message.includes("Updated ref refs/remotes/peer/main"),
      );
      expect(remoteRefLog).toBeDefined();

      const localMainLog = logs2.find(
        (e) => e.message.includes("Set local main") || e.message.includes("Updated local main"),
      );
      expect(localMainLog).toBeDefined();

      const client1Head = repoModel1.getState().headCommitId;
      expect(client1Head).toBeTruthy();
      expect(localMainLog?.message).toContain(client1Head?.slice(0, 7));
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

      // Client 1: Initialize repository and create files
      enqueueInitRepoAction(actionsModel1);
      await waitModel(repoModel1, (m) => m.getState().initialized);

      for (let i = 1; i <= 2; i++) {
        enqueueAddFileAction(actionsModel1, {
          name: `client1-file${i}.txt`,
          content: `Client 1 file ${i}`,
        });
        const expectedCount = i + 1;
        await waitModel(repoModel1, (m) => m.getState().commitCount === expectedCount);
      }
      expect(repoModel1.getState().commitCount).toBe(3);

      // Client 1: Share
      enqueueShareAction(actionsModel1);
      await waitModel(sessionModel1, (m) => m.getState().mode === "hosting");
      const sessionId = sessionModel1.getState().sessionId;
      if (!sessionId) throw new Error("Session ID not set");

      // Client 2: Join
      enqueueJoinAction(actionsModel2, { sessionId });
      await waitModel(peersModel2, (m) => m.getAll()[0]?.status === "connected", 10000);
      await waitModel(peersModel1, (m) => m.getAll()[0]?.status === "connected", 10000);

      // Client 2: First sync
      const hostPeerId = peersModel2.getAll()[0].id;
      enqueueStartSyncAction(actionsModel2, { peerId: hostPeerId });
      await waitModel(
        syncModel2,
        (m) => m.getState().phase === "complete" || m.getState().phase === "error",
        10000,
      );
      expect(syncModel2.getState().phase).toBe("complete");

      // Advance the mock timer to trigger sync model reset
      const timerApi2 = getTimerApi(ctx2) as MockTimerApi;
      timerApi2.advance(3000);

      await waitModel(syncModel2, (m) => m.getState().phase === "idle", 5000);

      // Wait for checkout and refresh to complete after sync
      await flushPromises(20);
      await waitModel(
        repoModel2,
        (m) => m.getState().commitCount === repoModel1.getState().commitCount,
        5000,
      );

      // Client 2: Create new files (2 additional commits)
      logModel2.info("--- Client 2 creating new commits ---");
      for (let i = 1; i <= 2; i++) {
        enqueueAddFileAction(actionsModel2, {
          name: `client2-file${i}.txt`,
          content: `Client 2 file ${i}`,
        });
        const expectedCount = repoModel1.getState().commitCount + i;
        await waitModel(repoModel2, (m) => m.getState().commitCount === expectedCount, 5000);
      }

      const client2CommitCount = repoModel2.getState().commitCount;
      const client1CommitCount = repoModel1.getState().commitCount;
      expect(client2CommitCount).toBe(client1CommitCount + 2);

      // Client 2: Second sync
      logModel2.info("--- Client 2 starting second sync ---");
      enqueueStartSyncAction(actionsModel2, { peerId: hostPeerId });

      await waitModel(
        syncModel2,
        (m) => m.getState().phase === "complete" || m.getState().phase === "error",
        15000,
      );

      expect(syncModel2.getState().phase).toBe("complete");

      const client2Head = repoModel2.getState().headCommitId;
      expect(client2Head).toBeTruthy();
    },
  );
});
