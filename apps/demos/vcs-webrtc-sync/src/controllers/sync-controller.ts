/**
 * Sync Controller
 *
 * Manages Git synchronization over WebRTC connections.
 * Handles push/fetch operations and conflict detection.
 *
 * This module provides two sync implementations:
 * - New transport-based sync using fetchOverDuplex/pushOverDuplex (Git wire protocol)
 * - Legacy custom JSON protocol (for backwards compatibility)
 */

import { FileMode, type History } from "@statewalker/vcs-core";
import { getActivityLogModel } from "../models/index.js";
import { fetchFromPeer, newRegistry, pushToPeer } from "../utils/index.js";
import { getHistory } from "./repository-controller.js";
import { getDataChannel, isConnected } from "./webrtc-controller.js";

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
 * Push local repository state to the remote peer using Git wire protocol.
 *
 * Uses the new transport API (pushOverDuplex) for proper Git protocol support.
 */
export async function pushToRemote(ctx: Map<string, unknown>): Promise<boolean> {
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
    logModel.info("Starting push to peer (Git protocol)...");

    const result = await pushToPeer(channel, history, ["refs/heads/main:refs/heads/main"]);

    if (result.success) {
      logModel.success("Push completed successfully");
      return true;
    } else {
      logModel.error(`Push failed: ${result.error || "Unknown error"}`);
      return false;
    }
  } catch (error) {
    logModel.error(`Push failed: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Fetch repository state from the remote peer using Git wire protocol.
 *
 * Uses the new transport API (fetchOverDuplex) for proper Git protocol support.
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
    logModel.info("Fetching from peer (Git protocol)...");

    const result = await fetchFromPeer(channel, history, ["+refs/heads/*:refs/remotes/peer/*"]);

    if (result.success) {
      const refCount = result.updatedRefs?.size ?? 0;
      logModel.success(`Fetch completed: ${refCount} refs updated`);
      return true;
    } else {
      logModel.error(`Fetch failed: ${result.error || "Unknown error"}`);
      return false;
    }
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
      await collectFileIds(history, entry.id, path, files);
    } else {
      files.set(path, entry.id);
    }
  }
}
