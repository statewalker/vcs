/**
 * Fetch negotiation logic.
 *
 * The negotiator handles the "want/have" exchange between client and server
 * to determine which objects need to be transferred. It aims to minimize
 * data transfer by finding common ancestors.
 *
 * Based on JGit's BasePackFetchConnection.java
 */

import { bytesToHex } from "@webrun-vcs/utils/hash/utils";
import { negotiateCapabilities } from "../protocol/capabilities.js";
import { PACKET_DONE, PACKET_HAVE, PACKET_WANT } from "../protocol/constants.js";
import { dataPacket, flushPacket } from "../protocol/pkt-line-codec.js";
import type { Packet, RefAdvertisement } from "../protocol/types.js";

/**
 * Maximum number of "have" commits to send before giving up on negotiation.
 * This prevents infinite loops when there's no common history.
 */
export const MAX_HAVES = 256;

/**
 * Minimum client buffer size required to prevent deadlock.
 * This ensures we can read ACK responses while sending haves.
 */
export const MIN_CLIENT_BUFFER = 2 * 32 * 46 + 8;

/**
 * Request for a fetch operation.
 */
export interface FetchRequest {
  /** Object IDs we want to receive */
  wants: Uint8Array[];
  /** Object IDs we already have (for negotiation) */
  haves: Uint8Array[];
  /** Shallow clone depth (optional) */
  depth?: number;
  /** Deepen-since date (optional) */
  deepenSince?: Date;
  /** Refs to exclude from deepening (optional) */
  deepenNot?: string[];
  /** Requested capabilities */
  capabilities: string[];
  /** Filter spec (optional, e.g., "blob:none") */
  filter?: string;
}

/**
 * Build the list of wanted object IDs from ref advertisement.
 *
 * @param advertisement - Server's ref advertisement
 * @param patterns - Optional patterns to filter refs
 * @param localHas - Function to check if we already have an object
 */
export async function buildWants(
  advertisement: RefAdvertisement,
  patterns?: string[],
  localHas?: (id: Uint8Array) => Promise<boolean>,
): Promise<Uint8Array[]> {
  const wants: Uint8Array[] = [];
  const seen = new Set<string>();

  for (const [refName, objectId] of advertisement.refs) {
    // Filter by pattern if provided
    if (patterns && patterns.length > 0) {
      const matches = patterns.some((p) => {
        if (p.endsWith("*")) {
          return refName.startsWith(p.slice(0, -1));
        }
        return refName === p;
      });
      if (!matches) {
        continue;
      }
    }

    // Skip if we already have this object
    if (localHas && (await localHas(objectId))) {
      continue;
    }

    // Skip duplicates
    const idHex = bytesToHex(objectId);
    if (seen.has(idHex)) {
      continue;
    }
    seen.add(idHex);

    wants.push(objectId);
  }

  return wants;
}

/**
 * Build a fetch request.
 */
export function buildFetchRequest(
  wants: Uint8Array[],
  serverCaps: Set<string>,
  haves: Uint8Array[] = [],
  options: Partial<FetchRequest> = {},
): FetchRequest {
  return {
    wants,
    haves,
    depth: options.depth,
    deepenSince: options.deepenSince,
    deepenNot: options.deepenNot,
    capabilities: negotiateCapabilities(serverCaps),
    filter: options.filter,
  };
}

/**
 * Generate protocol v0/v1 fetch request packets.
 *
 * Format:
 * - want <id> <capabilities> (first want)
 * - want <id> (subsequent wants)
 * - shallow <id> (if shallow)
 * - deepen <depth> (if depth specified)
 * - flush
 * - have <id> (for each have)
 * - done
 */
export async function* generateFetchRequestPackets(request: FetchRequest): AsyncGenerator<Packet> {
  if (request.wants.length === 0) {
    return;
  }

  // First want line includes capabilities
  const firstWant = request.wants[0];
  const capsStr = request.capabilities.join(" ");
  yield dataPacket(`${PACKET_WANT}${bytesToHex(firstWant)} ${capsStr}\n`);

  // Remaining wants
  for (let i = 1; i < request.wants.length; i++) {
    yield dataPacket(`${PACKET_WANT}${bytesToHex(request.wants[i])}\n`);
  }

  // Depth options
  if (request.depth !== undefined && request.depth > 0) {
    yield dataPacket(`deepen ${request.depth}\n`);
  }

  if (request.deepenSince) {
    const timestamp = Math.floor(request.deepenSince.getTime() / 1000);
    yield dataPacket(`deepen-since ${timestamp}\n`);
  }

  if (request.deepenNot) {
    for (const ref of request.deepenNot) {
      yield dataPacket(`deepen-not ${ref}\n`);
    }
  }

  // Filter
  if (request.filter) {
    yield dataPacket(`filter ${request.filter}\n`);
  }

  // Flush after wants
  yield flushPacket();

  // Have lines (if any)
  for (const have of request.haves) {
    yield dataPacket(`${PACKET_HAVE}${bytesToHex(have)}\n`);
  }

  // Done
  yield dataPacket(`${PACKET_DONE}\n`);
}

/**
 * Generate protocol v2 fetch request packets.
 *
 * Format:
 * - command=fetch
 * - delim
 * - want <id>
 * - have <id>
 * - done
 * - flush
 */
export async function* generateV2FetchRequestPackets(
  request: FetchRequest,
): AsyncGenerator<Packet> {
  if (request.wants.length === 0) {
    return;
  }

  // Command
  yield dataPacket("command=fetch\n");

  // Capabilities as features
  for (const cap of request.capabilities) {
    if (
      cap === "thin-pack" ||
      cap === "no-progress" ||
      cap === "include-tag" ||
      cap === "ofs-delta"
    ) {
      yield dataPacket(`${cap}\n`);
    }
  }

  // Delimiter between capabilities and arguments
  yield { type: "delim" };

  // Wants
  for (const want of request.wants) {
    yield dataPacket(`want ${bytesToHex(want)}\n`);
  }

  // Depth
  if (request.depth !== undefined && request.depth > 0) {
    yield dataPacket(`deepen ${request.depth}\n`);
  }

  // Filter
  if (request.filter) {
    yield dataPacket(`filter ${request.filter}\n`);
  }

  // Haves
  for (const have of request.haves) {
    yield dataPacket(`have ${bytesToHex(have)}\n`);
  }

  // Done
  yield dataPacket("done\n");

  // Flush
  yield flushPacket();
}

/**
 * State machine for fetch negotiation.
 */
export class FetchNegotiator {
  private havesSent = 0;
  private commonBase: Uint8Array | null = null;
  private done = false;

  /**
   * Check if negotiation is complete.
   */
  isDone(): boolean {
    return this.done;
  }

  /**
   * Get the common base found during negotiation.
   */
  getCommonBase(): Uint8Array | null {
    return this.commonBase;
  }

  /**
   * Record that an ACK was received for a commit.
   */
  recordAck(objectId: Uint8Array): void {
    this.commonBase = objectId;
  }

  /**
   * Record that a NAK was received.
   */
  recordNak(): void {
    // Nothing to do for NAK
  }

  /**
   * Mark negotiation as complete.
   */
  markDone(): void {
    this.done = true;
  }

  /**
   * Check if we should continue sending haves.
   */
  shouldContinue(): boolean {
    return this.havesSent < MAX_HAVES && !this.done;
  }

  /**
   * Increment the have counter.
   */
  incrementHaves(): void {
    this.havesSent++;
  }
}
