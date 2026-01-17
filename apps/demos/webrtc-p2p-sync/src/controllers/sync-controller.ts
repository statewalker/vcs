/**
 * Sync controller - orchestrates Git synchronization over WebRTC.
 *
 * Handles:
 * - Starting sync with a peer
 * - Exchanging Git objects over PeerJS DataConnection
 * - Tracking sync progress
 * - Handling sync errors
 */

import type { HistoryStore } from "@statewalker/vcs-core";
import {
  enqueueCheckout,
  enqueueRefreshRepo,
  listenCancelSync,
  listenStartSync,
} from "../actions/index.js";
import type { PeerConnection } from "../apis/index.js";
import { getTimerApi } from "../apis/index.js";
import {
  getActivityLogModel,
  getPeersModel,
  getSyncModel,
  getUserActionsModel,
} from "../models/index.js";
import { newRegistry } from "../utils/index.js";
import type { AppContext } from "./index.js";
import { getPeerConnections, getRepository } from "./index.js";

// How long to show "complete" state before resetting
const COMPLETE_DISPLAY_MS = 2000;

/**
 * Message types for sync protocol.
 */
type SyncMessageType = "repo-info" | "send-objects" | "sync-complete" | "error";

interface SyncMessage {
  type: SyncMessageType;
  data?: unknown;
}

/**
 * Create the sync controller.
 *
 * @param ctx The application context
 * @returns Cleanup function
 */
export function createSyncController(ctx: AppContext): () => void {
  const [register, cleanup] = newRegistry();

  // Get models
  const syncModel = getSyncModel(ctx);
  const peersModel = getPeersModel(ctx);
  const logModel = getActivityLogModel(ctx);
  const actionsModel = getUserActionsModel(ctx);

  // Get APIs
  const timerApi = getTimerApi(ctx);

  // Get peer connections
  const connections = getPeerConnections(ctx);

  // Track which connections have handlers
  const handlersSet = new Set<string>();

  // Track ID mappings for each peer during sync (sent ID -> stored ID)
  const peerIdMappings = new Map<string, Map<string, string>>();

  // Message queues for serializing message processing per peer
  const messageQueues = new Map<string, SyncMessage[]>();
  const processingFlags = new Map<string, boolean>();

  // Set up message handlers when peers update
  register(
    peersModel.onUpdate(() => {
      // When a peer connects, set up message handler
      for (const [peerId, conn] of connections) {
        setupMessageHandler(peerId, conn);
      }
    }),
  );

  /**
   * Set up message handler for a connection.
   */
  function setupMessageHandler(peerId: string, conn: PeerConnection): void {
    if (handlersSet.has(peerId)) return;
    handlersSet.add(peerId);

    // Initialize queue for this peer
    messageQueues.set(peerId, []);
    processingFlags.set(peerId, false);

    conn.on("data", (data: unknown) => {
      try {
        // Parse message
        let message: SyncMessage;
        if (typeof data === "string") {
          message = JSON.parse(data);
        } else if (data instanceof ArrayBuffer) {
          message = JSON.parse(new TextDecoder().decode(data));
        } else if (data instanceof Uint8Array) {
          message = JSON.parse(new TextDecoder().decode(data));
        } else {
          return; // Unknown format
        }

        // Add to queue and process
        const queue = messageQueues.get(peerId);
        if (queue) {
          queue.push(message);
          processMessageQueue(peerId, conn);
        }
      } catch {
        // Ignore parse errors - might be non-sync data
      }
    });

    conn.on("close", () => {
      handlersSet.delete(peerId);
      messageQueues.delete(peerId);
      processingFlags.delete(peerId);
    });
  }

  /**
   * Process messages from the queue one at a time.
   */
  async function processMessageQueue(peerId: string, conn: PeerConnection): Promise<void> {
    // Check if already processing
    if (processingFlags.get(peerId)) return;
    processingFlags.set(peerId, true);

    const queue = messageQueues.get(peerId);
    while (queue && queue.length > 0) {
      const message = queue.shift();
      if (message) {
        try {
          await handleIncomingMessage(peerId, conn, message);
        } catch (e) {
          logModel.error(`Error processing message: ${(e as Error).message}`);
        }
      }
    }

    processingFlags.set(peerId, false);
  }

  /**
   * Handle incoming sync message.
   */
  async function handleIncomingMessage(
    peerId: string,
    conn: PeerConnection,
    message: SyncMessage,
  ): Promise<void> {
    const store = getRepository(ctx);
    const displayName = peersModel.get(peerId)?.displayName ?? peerId;

    // If no store exists, we can't handle sync messages
    if (!store) {
      if (message.type === "repo-info" && (message.data as { request?: boolean })?.request) {
        // They're asking for our data but we have none - just send empty response
        sendMessage(conn, {
          type: "repo-info",
          data: { head: null, branch: "main", objectCount: 0 },
        });
        sendMessage(conn, { type: "sync-complete", data: { head: null, objectCount: 0 } });
      }
      return;
    }

    switch (message.type) {
      case "repo-info": {
        const info = message.data as {
          request?: boolean;
          head?: string;
          branch?: string;
          objectCount?: number;
        };

        if (info.request) {
          // Peer is requesting our repo info - send it back along with objects
          logModel.info(`${displayName} requested sync, sending data...`);
          await sendRepoData(conn, store, logModel);
        } else {
          // Received remote repo info
          logModel.info(
            `Remote ${displayName} has ${info.objectCount || 0} objects, HEAD: ${info.head?.slice(0, 7) || "none"}`,
          );
        }
        break;
      }

      case "send-objects": {
        const obj = message.data as {
          type: string;
          id: string;
          data: number[];
        };
        const data = new Uint8Array(obj.data);

        // Get or create ID mapping for this peer
        let idMapping = peerIdMappings.get(peerId);
        if (!idMapping) {
          idMapping = new Map();
          peerIdMappings.set(peerId, idMapping);
        }

        try {
          // Store the object based on type and capture the stored ID
          let storedId: string | undefined;
          if (obj.type === "commit") {
            const commitData = JSON.parse(new TextDecoder().decode(data));
            storedId = await store.commits.storeCommit(commitData);
          } else if (obj.type === "tree") {
            const treeData = JSON.parse(new TextDecoder().decode(data));
            storedId = await store.trees.storeTree(treeData);
          } else if (obj.type === "blob") {
            storedId = await store.blobs.store([data]);
          }

          // Track the mapping from sent ID to stored ID
          if (storedId) {
            idMapping.set(obj.id, storedId);
          }
        } catch (e) {
          logModel.warn(
            `Failed to store ${obj.type} ${obj.id.slice(0, 7)}: ${(e as Error).message}`,
          );
        }
        break;
      }

      case "sync-complete": {
        const info = message.data as { head?: string; objectCount?: number } | undefined;

        // Get ID mapping for this peer (maps sent IDs to stored IDs)
        const idMapping = peerIdMappings.get(peerId);

        if (info?.head) {
          // Map the sent HEAD to the actual stored ID
          const actualHead = idMapping?.get(info.head) ?? info.head;

          // Update remote tracking ref
          await store.refs.set("refs/remotes/peer/main", actualHead);

          // Check if we should fast-forward local branch
          const localRef = await store.refs.get("refs/heads/main");
          const localHead = localRef && "objectId" in localRef ? localRef.objectId : null;

          if (!localHead) {
            // No local commits - just set to remote head
            await store.refs.set("refs/heads/main", actualHead);
            logModel.info(`Set local branch to remote HEAD ${actualHead.slice(0, 7)}`);
          } else if (localHead !== actualHead) {
            // Check if remote is ahead (fast-forward possible)
            const canFastForward = await isAncestor(store, localHead, actualHead);
            if (canFastForward) {
              await store.refs.set("refs/heads/main", actualHead);
              logModel.info(`Fast-forwarded to ${actualHead.slice(0, 7)}`);
            } else {
              // Check if local is ahead of remote (we're ahead)
              const remoteIsAncestor = await isAncestor(store, actualHead, localHead);
              if (remoteIsAncestor) {
                logModel.info(`Local is ahead of remote - keeping local HEAD`);
              } else {
                // Histories truly diverged - for demo, accept remote
                // This allows syncing between independently initialized repos
                await store.refs.set("refs/heads/main", actualHead);
                logModel.warn(
                  `Histories diverged - accepting remote HEAD ${actualHead.slice(0, 7)}`,
                );
              }
            }
          }
        }

        // Clean up ID mapping for this peer
        peerIdMappings.delete(peerId);

        logModel.info(`Received ${info?.objectCount || 0} objects from ${displayName}`);

        // Checkout HEAD to update working directory with synced files
        enqueueCheckout(actionsModel);
        break;
      }

      case "error": {
        logModel.error(`Sync error from ${displayName}: ${message.data}`);
        break;
      }
    }
  }

  // Listen to user actions via typed action adapters
  register(
    listenStartSync(actionsModel, (actions) => {
      for (const { peerId } of actions) {
        handleSyncStart(peerId);
      }
    }),
  );

  register(
    listenCancelSync(actionsModel, () => {
      handleSyncCancel();
    }),
  );

  /**
   * Start sync with a peer.
   */
  async function handleSyncStart(peerId: string): Promise<void> {
    // Don't start if already syncing
    if (syncModel.isActive) {
      logModel.warn("Sync already in progress");
      return;
    }

    // Get the peer connection
    const conn = connections.get(peerId);
    if (!conn) {
      logModel.error(`Peer ${peerId} not connected`);
      return;
    }

    // Get repository store (initialized in createAppContext)
    const store = getRepository(ctx);
    if (!store) {
      logModel.error("Repository not initialized");
      return;
    }

    const displayName = peersModel.get(peerId)?.displayName ?? peerId;
    logModel.info(`Starting sync with ${displayName}...`);

    // Start sync
    syncModel.startSync(peerId);

    try {
      // Update phase
      syncModel.update({ phase: "negotiating" });

      // Request remote repo data
      sendMessage(conn, { type: "repo-info", data: { request: true } });

      // Send our repo data (may be empty if we just created the store)
      syncModel.update({ phase: "sending" });
      await sendRepoData(conn, store, logModel);

      // Mark complete
      syncModel.complete();
      peersModel.updatePeer(peerId, { lastSyncAt: new Date() });
      logModel.info(`Sync complete with ${displayName}`);

      // Reset after delay
      timerApi.setTimeout(() => {
        if (syncModel.getState().phase === "complete") {
          syncModel.reset();
        }
      }, COMPLETE_DISPLAY_MS);

      // Refresh repository state
      enqueueRefreshRepo(actionsModel);
    } catch (error) {
      const message = (error as Error).message;
      syncModel.fail(message);
      logModel.error(`Sync failed: ${message}`);

      // Reset after delay
      timerApi.setTimeout(() => {
        if (syncModel.getState().phase === "error") {
          syncModel.reset();
        }
      }, COMPLETE_DISPLAY_MS);
    }
  }

  /**
   * Cancel ongoing sync.
   */
  function handleSyncCancel(): void {
    if (!syncModel.isActive) return;

    logModel.warn("Sync cancelled");
    syncModel.reset();
  }

  return cleanup;
}

/**
 * Send repository data to a peer.
 */
async function sendRepoData(
  conn: PeerConnection,
  store: HistoryStore,
  logModel: { info: (msg: string) => void },
): Promise<void> {
  // Get current HEAD
  const headRef = await store.refs.get("refs/heads/main");
  const head = headRef && "objectId" in headRef ? headRef.objectId : null;

  if (!head) {
    // No commits to send
    sendMessage(conn, {
      type: "repo-info",
      data: { head: null, branch: "main", objectCount: 0 },
    });
    sendMessage(conn, { type: "sync-complete", data: { head: null, objectCount: 0 } });
    return;
  }

  // Collect objects to send
  const objects: Array<{ type: string; id: string; data: Uint8Array }> = [];
  const seen = new Set<string>();

  // Walk all commits in history
  let currentId: string | undefined = head;
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);

    const commit = await store.commits.loadCommit(currentId);

    // Serialize commit
    const commitData = new TextEncoder().encode(
      JSON.stringify({
        tree: commit.tree,
        parents: commit.parents,
        message: commit.message,
        author: commit.author,
        committer: commit.committer,
      }),
    );
    objects.push({ type: "commit", id: currentId, data: commitData });

    // Collect tree objects
    if (commit.tree) {
      await collectTreeObjects(store, commit.tree, objects, seen);
    }

    currentId = commit.parents[0];
  }

  logModel.info(`Sending ${objects.length} objects...`);

  // Send repo info
  sendMessage(conn, {
    type: "repo-info",
    data: {
      head,
      branch: "main",
      objectCount: objects.length,
    },
  });

  // Send objects
  for (const obj of objects) {
    sendMessage(conn, {
      type: "send-objects",
      data: {
        type: obj.type,
        id: obj.id,
        data: Array.from(obj.data),
      },
    });
  }

  // Send completion
  sendMessage(conn, { type: "sync-complete", data: { head, objectCount: objects.length } });
}

/**
 * Collect tree and blob objects recursively.
 */
async function collectTreeObjects(
  store: HistoryStore,
  treeId: string,
  objects: Array<{ type: string; id: string; data: Uint8Array }>,
  seen: Set<string>,
): Promise<void> {
  if (seen.has(treeId)) return;
  seen.add(treeId);

  const entries: Array<{ name: string; mode: number; id: string }> = [];

  for await (const entry of store.trees.loadTree(treeId)) {
    entries.push({ name: entry.name, mode: entry.mode, id: entry.id });

    if (entry.mode === 0o040000) {
      // Directory - recurse
      await collectTreeObjects(store, entry.id, objects, seen);
    } else {
      // File - collect blob
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        const chunks: Uint8Array[] = [];
        for await (const chunk of store.blobs.load(entry.id)) {
          chunks.push(chunk);
        }
        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        const data = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          data.set(chunk, offset);
          offset += chunk.length;
        }
        objects.push({ type: "blob", id: entry.id, data });
      }
    }
  }

  // Serialize tree
  const treeData = new TextEncoder().encode(JSON.stringify(entries));
  objects.push({ type: "tree", id: treeId, data: treeData });
}

/**
 * Send a message over the connection.
 */
function sendMessage(conn: PeerConnection, message: SyncMessage): void {
  const data = new TextEncoder().encode(JSON.stringify(message));
  conn.send(data);
}

/**
 * Check if potentialAncestor is an ancestor of commit.
 * Returns true if potentialAncestor can be reached by walking back from commit.
 */
async function isAncestor(
  store: HistoryStore,
  potentialAncestor: string,
  commit: string,
): Promise<boolean> {
  const visited = new Set<string>();
  const queue = [commit];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (current === potentialAncestor) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    // Limit search depth to avoid infinite loops
    if (visited.size > 100) {
      return false;
    }

    try {
      const commitObj = await store.commits.loadCommit(current);
      for (const parent of commitObj.parents) {
        if (!visited.has(parent)) {
          queue.push(parent);
        }
      }
    } catch {
      // Commit not found - stop searching this branch
    }
  }

  return false;
}
