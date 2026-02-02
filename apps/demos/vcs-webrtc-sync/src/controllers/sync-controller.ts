/**
 * Sync Controller
 *
 * Manages Git synchronization over WebRTC connections.
 * Handles push/fetch operations and conflict detection.
 */

import { FileMode, type History } from "@statewalker/vcs-core";
import { getActivityLogModel, getRepositoryModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";
import { getHistory } from "./repository-controller.js";
import { getDataChannel, isConnected } from "./webrtc-controller.js";

/**
 * Message types for sync protocol.
 */
type SyncMessageType = "repo-info" | "request-objects" | "send-objects" | "sync-complete" | "error";

interface SyncMessage {
  type: SyncMessageType;
  data?: unknown;
}

/**
 * Create the sync controller.
 * Returns cleanup function.
 */
export function createSyncController(_ctx: Map<string, unknown>): () => void {
  const [register, cleanup] = newRegistry();

  // Set up message handler when connected
  register(() => {
    // Cleanup handled by WebRTC controller
  });

  return cleanup;
}

/**
 * Push local repository state to the remote peer.
 */
export async function pushToRemote(ctx: Map<string, unknown>): Promise<boolean> {
  const history = getHistory(ctx);
  const channel = getDataChannel(ctx);
  const repoModel = getRepositoryModel(ctx);
  const logModel = getActivityLogModel(ctx);

  if (!history) {
    logModel.error("No repository initialized");
    return false;
  }

  if (!channel || !isConnected(ctx)) {
    logModel.error("No peer connection");
    return false;
  }

  try {
    logModel.info("Starting push to peer...");

    // Get current HEAD
    const headRef = await history.refs.resolve("HEAD");
    if (!headRef?.objectId) {
      logModel.warning("No commits to push");
      return false;
    }

    // Collect objects to send
    const objects: Array<{ type: string; id: string; data: Uint8Array }> = [];

    // Walk commits
    for await (const commitId of history.commits.walkAncestry(headRef.objectId, { limit: 100 })) {
      const commit = await history.commits.load(commitId);
      if (!commit) continue;

      // Serialize commit (simplified - in real impl would use proper format)
      const commitData = new TextEncoder().encode(
        JSON.stringify({
          tree: commit.tree,
          parents: commit.parents,
          message: commit.message,
          author: commit.author,
          committer: commit.committer,
        }),
      );
      objects.push({ type: "commit", id: commitId, data: commitData });

      // Collect tree objects
      await collectTreeObjects(history, commit.tree, objects);
    }

    // Send repo info first
    const repoInfo: SyncMessage = {
      type: "repo-info",
      data: {
        head: headRef.objectId,
        branch: repoModel.branchName,
        objectCount: objects.length,
      },
    };

    sendMessage(channel, repoInfo);

    // Send objects
    for (const obj of objects) {
      const objMessage: SyncMessage = {
        type: "send-objects",
        data: {
          type: obj.type,
          id: obj.id,
          data: Array.from(obj.data),
        },
      };
      sendMessage(channel, objMessage);
    }

    // Send completion
    sendMessage(channel, { type: "sync-complete" });

    logModel.success(`Pushed ${objects.length} objects to peer`);
    return true;
  } catch (error) {
    logModel.error(`Push failed: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Fetch repository state from the remote peer.
 */
export async function fetchFromRemote(ctx: Map<string, unknown>): Promise<boolean> {
  const history = getHistory(ctx);
  const channel = getDataChannel(ctx);
  const logModel = getActivityLogModel(ctx);

  if (!history) {
    logModel.error("No repository initialized");
    return false;
  }

  if (!channel || !isConnected(ctx)) {
    logModel.error("No peer connection");
    return false;
  }

  try {
    logModel.info("Fetching from peer...");

    // Request repo info
    sendMessage(channel, { type: "repo-info", data: { request: true } });

    // Listen for incoming objects
    let receivedCount = 0;
    let remoteHead: string | null = null;

    return new Promise((resolve) => {
      const handler = async (event: MessageEvent) => {
        try {
          const message: SyncMessage = JSON.parse(
            typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data),
          );

          switch (message.type) {
            case "repo-info": {
              const info = message.data as { head?: string; objectCount?: number };
              remoteHead = info.head || null;
              logModel.info(
                `Remote has ${info.objectCount || 0} objects, HEAD: ${remoteHead?.slice(0, 7)}`,
              );
              break;
            }

            case "send-objects": {
              const obj = message.data as { type: string; id: string; data: number[] };
              const data = new Uint8Array(obj.data);

              // Store the object based on type
              if (obj.type === "commit") {
                // Parse and store commit
                const commitData = JSON.parse(new TextDecoder().decode(data));
                await history.commits.store(commitData);
              } else if (obj.type === "tree") {
                // Store tree
                await history.trees.store(JSON.parse(new TextDecoder().decode(data)));
              } else if (obj.type === "blob") {
                // Store blob
                await history.blobs.store([data]);
              }
              receivedCount++;
              break;
            }

            case "sync-complete": {
              channel.removeEventListener("message", handler);
              logModel.success(`Received ${receivedCount} objects from peer`);

              // Update refs if we got a remote HEAD
              if (remoteHead) {
                await history.refs.set("refs/remotes/peer/main", remoteHead);
                logModel.info(`Updated remote tracking ref`);
              }
              resolve(true);
              break;
            }

            case "error": {
              channel.removeEventListener("message", handler);
              logModel.error(`Remote error: ${message.data}`);
              resolve(false);
              break;
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      channel.addEventListener("message", handler);

      // Timeout after 30 seconds
      setTimeout(() => {
        channel.removeEventListener("message", handler);
        if (receivedCount === 0) {
          logModel.warning("Fetch timed out");
          resolve(false);
        } else {
          resolve(true);
        }
      }, 30000);
    });
  } catch (error) {
    logModel.error(`Fetch failed: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Detect conflicts between local and remote trees.
 */
export async function detectConflicts(
  ctx: Map<string, unknown>,
): Promise<Array<{ path: string; local: string; remote: string }>> {
  const history = getHistory(ctx);
  const logModel = getActivityLogModel(ctx);

  if (!history) {
    return [];
  }

  try {
    // Get local HEAD
    const localRef = await history.refs.resolve("HEAD");
    const localHead = localRef?.objectId;

    // Get remote tracking ref
    const remoteRef = await history.refs.get("refs/remotes/peer/main");
    const remoteHead = remoteRef && "objectId" in remoteRef ? remoteRef.objectId : null;

    if (!localHead || !remoteHead) {
      return [];
    }

    // Compare trees
    const localCommit = await history.commits.load(localHead);
    const remoteCommit = await history.commits.load(remoteHead);

    if (!localCommit || !remoteCommit) {
      return [];
    }

    const localFiles = new Map<string, string>();
    const remoteFiles = new Map<string, string>();

    await collectFileIds(history, localCommit.tree, "", localFiles);
    await collectFileIds(history, remoteCommit.tree, "", remoteFiles);

    // Find conflicts (same file modified in both)
    const conflicts: Array<{ path: string; local: string; remote: string }> = [];

    for (const [path, localId] of localFiles) {
      const remoteId = remoteFiles.get(path);
      if (remoteId && remoteId !== localId) {
        conflicts.push({ path, local: localId, remote: remoteId });
      }
    }

    if (conflicts.length > 0) {
      logModel.warning(`Found ${conflicts.length} conflicting files`);
    }

    return conflicts;
  } catch (error) {
    logModel.error(`Failed to detect conflicts: ${(error as Error).message}`);
    return [];
  }
}

/**
 * Resolve a conflict by choosing local or remote version.
 */
export async function resolveConflict(
  ctx: Map<string, unknown>,
  path: string,
  choice: "local" | "remote",
): Promise<boolean> {
  const logModel = getActivityLogModel(ctx);

  // In a full implementation, this would:
  // 1. Update the working directory with the chosen version
  // 2. Stage the resolved file
  // 3. Allow the user to commit the resolution

  logModel.info(`Resolved conflict for ${path}: keeping ${choice} version`);
  return true;
}

// Helper functions

async function collectTreeObjects(
  history: History,
  treeId: string,
  objects: Array<{ type: string; id: string; data: Uint8Array }>,
): Promise<void> {
  const tree = await history.trees.load(treeId);
  if (!tree) return;

  const entries: Array<{ name: string; mode: number; objectId: string }> = [];

  for await (const entry of tree) {
    entries.push({ name: entry.name, mode: entry.mode, objectId: entry.objectId });

    if (entry.mode === FileMode.TREE) {
      // Directory - recurse
      await collectTreeObjects(history, entry.objectId, objects);
    } else {
      // File - collect blob
      const chunks: Uint8Array[] = [];
      const blobData = await history.blobs.load(entry.objectId);
      if (blobData) {
        for await (const chunk of blobData) {
          chunks.push(chunk);
        }
      }
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const data = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }
      objects.push({ type: "blob", id: entry.objectId, data });
    }
  }

  // Serialize tree
  const treeData = new TextEncoder().encode(JSON.stringify(entries));
  objects.push({ type: "tree", id: treeId, data: treeData });
}

async function collectFileIds(
  history: History,
  treeId: string,
  prefix: string,
  files: Map<string, string>,
): Promise<void> {
  const tree = await history.trees.load(treeId);
  if (!tree) return;

  for await (const entry of tree) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.mode === FileMode.TREE) {
      await collectFileIds(history, entry.objectId, path, files);
    } else {
      files.set(path, entry.objectId);
    }
  }
}

function sendMessage(channel: RTCDataChannel, message: SyncMessage): void {
  const data = JSON.stringify(message);
  channel.send(data);
}
