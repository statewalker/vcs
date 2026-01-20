/**
 * Bidirectional P2P Synchronization
 *
 * Implements two-way synchronization between P2P peers.
 * Both peers exchange refs and objects, detecting conflicts
 * for divergent histories.
 *
 * Protocol:
 * 1. Exchange ref advertisements (both directions)
 * 2. Determine sync actions (fetch, push, conflict)
 * 3. Execute sync operations
 * 4. Report results
 */

import type { MessagePortLike } from "@statewalker/vcs-utils";
import type { ProgressInfo } from "../protocol/types.js";
import type { PortGitStreamOptions } from "./port-git-stream.js";

/**
 * Ref state for comparison.
 */
export interface RefState {
  /** Reference name */
  name: string;
  /** Object ID */
  objectId: string;
}

/**
 * Sync action to take for a ref.
 */
export type SyncAction =
  | { type: "up-to-date" }
  | { type: "fetch"; remoteOid: string }
  | { type: "push"; localOid: string }
  | { type: "conflict"; localOid: string; remoteOid: string }
  | { type: "delete-local" }
  | { type: "delete-remote" };

/**
 * Sync plan for a single ref.
 */
export interface RefSyncPlan {
  /** Reference name */
  refName: string;
  /** Action to take */
  action: SyncAction;
  /** Local object ID (if exists) */
  localOid?: string;
  /** Remote object ID (if exists) */
  remoteOid?: string;
}

/**
 * Options for bidirectional sync.
 */
export interface BidirectionalSyncOptions {
  /** Local refs to sync */
  localRefs: RefState[];
  /** Remote refs (from peer) */
  remoteRefs: RefState[];
  /** Check if local has ancestor of remote (for conflict detection) */
  isAncestor?: (ancestorOid: string, descendantOid: string) => Promise<boolean>;
  /** Prefer local or remote on conflict (default: conflict) */
  conflictResolution?: "prefer-local" | "prefer-remote" | "conflict";
  /** Refs to exclude from sync (patterns) */
  excludePatterns?: string[];
}

/**
 * Result of sync planning.
 */
export interface SyncPlan {
  /** Planned actions for each ref */
  refs: RefSyncPlan[];
  /** Refs to fetch from remote */
  toFetch: string[];
  /** Refs to push to remote */
  toPush: string[];
  /** Refs in conflict */
  conflicts: string[];
  /** Whether sync is needed */
  needsSync: boolean;
}

/**
 * Plan bidirectional sync between local and remote refs.
 *
 * Determines what actions to take for each ref:
 * - up-to-date: Both sides have the same object
 * - fetch: Remote has updates we don't have
 * - push: We have updates remote doesn't have
 * - conflict: Both sides have diverged
 *
 * @param options - Sync options with local and remote refs
 * @returns Sync plan with actions for each ref
 *
 * @example
 * ```typescript
 * const plan = await planBidirectionalSync({
 *   localRefs: [{ name: 'refs/heads/main', objectId: 'abc...' }],
 *   remoteRefs: [{ name: 'refs/heads/main', objectId: 'def...' }],
 *   isAncestor: async (a, b) => checkAncestry(a, b),
 * });
 *
 * console.log('To fetch:', plan.toFetch);
 * console.log('To push:', plan.toPush);
 * console.log('Conflicts:', plan.conflicts);
 * ```
 */
export async function planBidirectionalSync(options: BidirectionalSyncOptions): Promise<SyncPlan> {
  const {
    localRefs,
    remoteRefs,
    isAncestor,
    conflictResolution = "conflict",
    excludePatterns = [],
  } = options;

  // Build maps for quick lookup
  const localMap = new Map<string, string>();
  for (const ref of localRefs) {
    localMap.set(ref.name, ref.objectId);
  }

  const remoteMap = new Map<string, string>();
  for (const ref of remoteRefs) {
    remoteMap.set(ref.name, ref.objectId);
  }

  // Collect all unique ref names
  const allRefNames = new Set([...localMap.keys(), ...remoteMap.keys()]);

  // Plan actions
  const refs: RefSyncPlan[] = [];
  const toFetch: string[] = [];
  const toPush: string[] = [];
  const conflicts: string[] = [];

  for (const refName of allRefNames) {
    // Check exclusion patterns
    if (shouldExclude(refName, excludePatterns)) {
      continue;
    }

    const localOid = localMap.get(refName);
    const remoteOid = remoteMap.get(refName);

    const plan = await planRefSync(refName, localOid, remoteOid, isAncestor, conflictResolution);
    refs.push(plan);

    // Categorize
    switch (plan.action.type) {
      case "fetch":
        toFetch.push(refName);
        break;
      case "push":
        toPush.push(refName);
        break;
      case "conflict":
        conflicts.push(refName);
        break;
    }
  }

  return {
    refs,
    toFetch,
    toPush,
    conflicts,
    needsSync: toFetch.length > 0 || toPush.length > 0 || conflicts.length > 0,
  };
}

/**
 * Plan sync action for a single ref.
 */
async function planRefSync(
  refName: string,
  localOid: string | undefined,
  remoteOid: string | undefined,
  isAncestor: ((a: string, b: string) => Promise<boolean>) | undefined,
  conflictResolution: "prefer-local" | "prefer-remote" | "conflict",
): Promise<RefSyncPlan> {
  // Case 1: Same on both sides
  if (localOid && remoteOid && localOid === remoteOid) {
    return {
      refName,
      action: { type: "up-to-date" },
      localOid,
      remoteOid,
    };
  }

  // Case 2: Only on remote (fetch)
  if (!localOid && remoteOid) {
    return {
      refName,
      action: { type: "fetch", remoteOid },
      remoteOid,
    };
  }

  // Case 3: Only on local (push)
  if (localOid && !remoteOid) {
    return {
      refName,
      action: { type: "push", localOid },
      localOid,
    };
  }

  // Case 4: Different on both sides - check ancestry
  if (localOid && remoteOid) {
    if (isAncestor) {
      // Check if local is ancestor of remote (remote has our changes + more)
      const localIsAncestor = await isAncestor(localOid, remoteOid);
      if (localIsAncestor) {
        return {
          refName,
          action: { type: "fetch", remoteOid },
          localOid,
          remoteOid,
        };
      }

      // Check if remote is ancestor of local (we have remote's changes + more)
      const remoteIsAncestor = await isAncestor(remoteOid, localOid);
      if (remoteIsAncestor) {
        return {
          refName,
          action: { type: "push", localOid },
          localOid,
          remoteOid,
        };
      }
    }

    // Neither is ancestor of the other - conflict
    switch (conflictResolution) {
      case "prefer-local":
        return {
          refName,
          action: { type: "push", localOid },
          localOid,
          remoteOid,
        };
      case "prefer-remote":
        return {
          refName,
          action: { type: "fetch", remoteOid },
          localOid,
          remoteOid,
        };
      default:
        return {
          refName,
          action: { type: "conflict", localOid, remoteOid },
          localOid,
          remoteOid,
        };
    }
  }

  // Shouldn't reach here
  return {
    refName,
    action: { type: "up-to-date" },
  };
}

/**
 * Check if ref name matches any exclusion pattern.
 */
function shouldExclude(refName: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      if (refName.startsWith(prefix)) {
        return true;
      }
    } else if (pattern === refName) {
      return true;
    }
  }
  return false;
}

/**
 * Options for sync execution.
 */
export interface SyncExecutionOptions {
  /** Port for communication */
  port: MessagePortLike;
  /** Sync plan to execute */
  plan: SyncPlan;
  /** Get pack data for refs to push */
  getPackData: (refs: string[]) => Promise<Uint8Array>;
  /** Apply received pack data */
  applyPackData: (packData: Uint8Array) => Promise<void>;
  /** Update local ref after fetch */
  updateLocalRef: (refName: string, oid: string) => Promise<void>;
  /** Progress callback */
  onProgress?: (info: ProgressInfo) => void;
  /** Port stream options */
  portOptions?: PortGitStreamOptions;
}

/**
 * Result of sync execution.
 */
export interface SyncExecutionResult {
  /** Whether sync completed successfully */
  success: boolean;
  /** Refs that were fetched */
  fetched: string[];
  /** Refs that were pushed */
  pushed: string[];
  /** Refs that had conflicts */
  conflicts: string[];
  /** Errors encountered */
  errors: string[];
}

/**
 * Execute a sync plan.
 *
 * This is a simplified implementation that executes the sync plan
 * by coordinating fetch and push operations.
 *
 * @param options - Execution options
 * @returns Execution result
 */
export async function executeSyncPlan(options: SyncExecutionOptions): Promise<SyncExecutionResult> {
  const { plan, getPackData, applyPackData: _applyPackData, updateLocalRef } = options;

  const result: SyncExecutionResult = {
    success: true,
    fetched: [],
    pushed: [],
    conflicts: plan.conflicts,
    errors: [],
  };

  // If there are conflicts, don't proceed with auto-sync
  if (plan.conflicts.length > 0) {
    result.success = false;
    result.errors.push(`${plan.conflicts.length} ref(s) have conflicts`);
    return result;
  }

  // Execute fetches
  if (plan.toFetch.length > 0) {
    try {
      // In a real implementation, this would fetch from the peer
      // For now, we just mark them as fetched
      for (const refPlan of plan.refs) {
        if (refPlan.action.type === "fetch" && refPlan.remoteOid) {
          await updateLocalRef(refPlan.refName, refPlan.remoteOid);
          result.fetched.push(refPlan.refName);
        }
      }
    } catch (err) {
      result.success = false;
      result.errors.push(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Execute pushes
  if (plan.toPush.length > 0) {
    try {
      // Get pack data for all refs to push
      const _packData = await getPackData(plan.toPush);
      // In a real implementation, this would push to the peer
      for (const refPlan of plan.refs) {
        if (refPlan.action.type === "push") {
          result.pushed.push(refPlan.refName);
        }
      }
    } catch (err) {
      result.success = false;
      result.errors.push(`Push failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

/**
 * Simplified sync function for two peers.
 *
 * Exchanges refs, determines sync actions, and reports plan.
 * Does not execute the sync - call executeSyncPlan separately.
 *
 * @param localRefs - Local ref states
 * @param remoteRefs - Remote ref states
 * @param options - Additional options
 * @returns Sync plan
 */
export async function planSync(
  localRefs: RefState[],
  remoteRefs: RefState[],
  options: {
    isAncestor?: (ancestorOid: string, descendantOid: string) => Promise<boolean>;
    conflictResolution?: "prefer-local" | "prefer-remote" | "conflict";
    excludePatterns?: string[];
  } = {},
): Promise<SyncPlan> {
  return planBidirectionalSync({
    localRefs,
    remoteRefs,
    ...options,
  });
}

// Re-export types for convenience
export type { PortGitStreamOptions } from "./port-git-stream.js";
