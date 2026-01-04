/**
 * Push negotiation logic.
 *
 * The push negotiator builds the ref update commands for the send-pack protocol.
 * It generates the packet sequence needed to update refs on the remote.
 *
 * Based on JGit's BasePackPushConnection.java and PushProcess.java
 */

import { bytesToHex } from "@statewalker/vcs-utils/hash/utils";
import {
  CAPABILITY_ATOMIC,
  CAPABILITY_DELETE_REFS,
  CAPABILITY_OFS_DELTA,
  CAPABILITY_PUSH_OPTIONS,
  CAPABILITY_QUIET,
  CAPABILITY_REPORT_STATUS,
  CAPABILITY_SIDE_BAND_64K,
  OBJECT_ID_STRING_LENGTH,
  ZERO_ID,
} from "../protocol/constants.js";
import { dataPacket, flushPacket } from "../protocol/pkt-line-codec.js";
import type { Packet, RefAdvertisement } from "../protocol/types.js";

/**
 * A single ref update command.
 */
export interface RefUpdate {
  /** Local ref name (source) */
  src: string;
  /** Remote ref name (destination) */
  dst: string;
  /** Old object ID (current value on remote, or ZERO_ID for new ref) */
  oldId: string;
  /** New object ID (new value, or ZERO_ID for delete) */
  newId: string;
  /** Force update (ignore fast-forward check) */
  force?: boolean;
}

/**
 * Request for a push operation.
 */
export interface PushRequest {
  /** Ref updates to perform */
  updates: RefUpdate[];
  /** Requested capabilities */
  capabilities: string[];
  /** Use atomic push (all-or-nothing) */
  atomic?: boolean;
  /** Push options (if server supports push-options capability) */
  pushOptions?: string[];
}

/**
 * Default push capabilities we request.
 */
export const DEFAULT_PUSH_CAPABILITIES = [
  CAPABILITY_REPORT_STATUS,
  CAPABILITY_SIDE_BAND_64K,
  CAPABILITY_OFS_DELTA,
  CAPABILITY_QUIET,
];

/**
 * Negotiate push capabilities with server.
 *
 * @param serverCaps - Capabilities advertised by server
 * @param options - Push options
 */
export function negotiatePushCapabilities(
  serverCaps: Set<string>,
  options: { atomic?: boolean; pushOptions?: string[] } = {},
): string[] {
  const requested: string[] = [];

  for (const cap of DEFAULT_PUSH_CAPABILITIES) {
    if (serverCaps.has(cap)) {
      requested.push(cap);
    }
  }

  // Atomic if requested and supported
  if (options.atomic && serverCaps.has(CAPABILITY_ATOMIC)) {
    requested.push(CAPABILITY_ATOMIC);
  }

  // Push options if provided and supported
  if (options.pushOptions && options.pushOptions.length > 0) {
    if (serverCaps.has(CAPABILITY_PUSH_OPTIONS)) {
      requested.push(CAPABILITY_PUSH_OPTIONS);
    }
  }

  // Delete-refs capability if we have any deletions
  if (serverCaps.has(CAPABILITY_DELETE_REFS)) {
    requested.push(CAPABILITY_DELETE_REFS);
  }

  return requested;
}

/**
 * Build ref updates from refspecs.
 *
 * @param refspecs - Refspecs to push (e.g., "refs/heads/main:refs/heads/main")
 * @param localRefs - Map of local ref names to object IDs
 * @param remoteRefs - Remote ref advertisement
 * @param options - Push options
 */
export function buildRefUpdates(
  refspecs: string[],
  localRefs: Map<string, string>,
  remoteRefs: RefAdvertisement,
  options: { force?: boolean } = {},
): RefUpdate[] {
  const updates: RefUpdate[] = [];

  for (const refspec of refspecs) {
    const update = parseRefspecToUpdate(refspec, localRefs, remoteRefs, options.force ?? false);
    if (update) {
      updates.push(update);
    }
  }

  return updates;
}

/**
 * Parse a refspec into a ref update.
 *
 * Refspec format: [+]<src>:<dst>
 * - "+" prefix means force update
 * - Empty src means delete (e.g., ":refs/heads/branch")
 * - Empty dst means use same name as src
 *
 * @param refspec - Refspec string
 * @param localRefs - Map of local ref names to object IDs
 * @param remoteRefs - Remote ref advertisement
 * @param force - Force update flag
 */
function parseRefspecToUpdate(
  refspec: string,
  localRefs: Map<string, string>,
  remoteRefs: RefAdvertisement,
  force: boolean,
): RefUpdate | undefined {
  let spec = refspec;
  let forceFlag = force;

  // Check for force prefix
  if (spec.startsWith("+")) {
    forceFlag = true;
    spec = spec.slice(1);
  }

  const colonIdx = spec.indexOf(":");
  let src: string;
  let dst: string;

  if (colonIdx === -1) {
    // No colon means push to same ref name
    src = spec;
    dst = spec;
  } else {
    src = spec.slice(0, colonIdx);
    dst = spec.slice(colonIdx + 1);
  }

  // Empty destination means use source name
  if (!dst) {
    dst = src;
  }

  // Resolve source to object ID
  let newId: string;
  if (!src) {
    // Delete ref
    newId = ZERO_ID;
  } else {
    const localId = localRefs.get(src);
    if (!localId) {
      // Source ref doesn't exist locally
      return undefined;
    }
    newId = localId;
  }

  // Get current value on remote
  const remoteId = remoteRefs.refs.get(dst);
  const oldId = remoteId ? bytesToHex(remoteId) : ZERO_ID;

  // Skip if nothing to update
  if (oldId === newId) {
    return undefined;
  }

  return {
    src,
    dst,
    oldId,
    newId,
    force: forceFlag,
  };
}

/**
 * Build a push request.
 *
 * @param updates - Ref updates to perform
 * @param serverCaps - Server capabilities
 * @param options - Push options
 */
export function buildPushRequest(
  updates: RefUpdate[],
  serverCaps: Set<string>,
  options: { atomic?: boolean; pushOptions?: string[] } = {},
): PushRequest {
  return {
    updates,
    capabilities: negotiatePushCapabilities(serverCaps, options),
    atomic: options.atomic,
    pushOptions: options.pushOptions,
  };
}

/**
 * Generate push request packets.
 *
 * Format:
 * - <old-id> <new-id> <refname>\0<capabilities> (first update)
 * - <old-id> <new-id> <refname> (subsequent updates)
 * - flush
 * - [push-options section if enabled]
 * - [PACK data follows]
 *
 * @param request - Push request
 */
export async function* generatePushRequestPackets(request: PushRequest): AsyncGenerator<Packet> {
  if (request.updates.length === 0) {
    return;
  }

  // First update includes capabilities
  const firstUpdate = request.updates[0];
  const capsStr = request.capabilities.join(" ");
  const firstLine = formatRefUpdateLine(firstUpdate, capsStr);
  yield dataPacket(firstLine);

  // Remaining updates
  for (let i = 1; i < request.updates.length; i++) {
    yield dataPacket(formatRefUpdateLine(request.updates[i]));
  }

  // Flush after commands
  yield flushPacket();

  // Push options if enabled
  if (request.pushOptions && request.capabilities.includes(CAPABILITY_PUSH_OPTIONS)) {
    for (const option of request.pushOptions) {
      yield dataPacket(`${option}\n`);
    }
    yield flushPacket();
  }

  // PACK data follows (handled by caller)
}

/**
 * Format a ref update line.
 *
 * Format: <old-id> SP <new-id> SP <refname> [NUL <capabilities>] LF
 */
function formatRefUpdateLine(update: RefUpdate, capabilities?: string): string {
  const { oldId, newId, dst } = update;

  // Validate object IDs
  if (oldId.length !== OBJECT_ID_STRING_LENGTH) {
    throw new Error(`Invalid old object ID length: ${oldId.length}`);
  }
  if (newId.length !== OBJECT_ID_STRING_LENGTH) {
    throw new Error(`Invalid new object ID length: ${newId.length}`);
  }

  if (capabilities) {
    return `${oldId} ${newId} ${dst}\0${capabilities}\n`;
  }
  return `${oldId} ${newId} ${dst}\n`;
}

/**
 * Get the set of object IDs that need to be sent to the remote.
 *
 * This is a simplified version that returns the new IDs from updates.
 * A full implementation would walk the commit graph to find all reachable
 * objects not already on the remote.
 *
 * @param updates - Ref updates
 */
export function getObjectsToSend(updates: RefUpdate[]): string[] {
  const objects: string[] = [];
  const seen = new Set<string>();

  for (const update of updates) {
    // Skip deletes
    if (update.newId === ZERO_ID) {
      continue;
    }

    // Skip if already seen
    if (seen.has(update.newId)) {
      continue;
    }
    seen.add(update.newId);

    objects.push(update.newId);
  }

  return objects;
}

/**
 * Check if any updates are deletions.
 */
export function hasDeletes(updates: RefUpdate[]): boolean {
  return updates.some((u) => u.newId === ZERO_ID);
}

/**
 * Check if all updates are creating new refs (no existing refs being updated).
 */
export function allCreates(updates: RefUpdate[]): boolean {
  return updates.every((u) => u.oldId === ZERO_ID);
}

/**
 * Validate that updates are allowed.
 *
 * @param updates - Ref updates
 * @param serverCaps - Server capabilities
 * @throws Error if updates are not allowed
 */
export function validateUpdates(updates: RefUpdate[], serverCaps: Set<string>): void {
  // Check delete-refs capability
  if (hasDeletes(updates) && !serverCaps.has(CAPABILITY_DELETE_REFS)) {
    throw new Error("Server does not support deleting refs");
  }
}
