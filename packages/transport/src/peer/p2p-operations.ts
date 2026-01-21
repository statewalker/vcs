/**
 * P2P Git Operations: Client-side fetch and push over MessagePort.
 *
 * These functions implement the client side of the git protocol for P2P
 * communication. They use ClientProtocolSession to drive the protocol
 * over MessagePortLike connections.
 *
 * For the server side (responding to fetch/push requests), use the
 * handlers in ../handlers/ with ServerProtocolSession.
 */

import type { MessagePortLike } from "@statewalker/vcs-utils";
import { CAPABILITY_OFS_DELTA, CAPABILITY_SIDE_BAND_64K } from "../protocol/constants.js";
import { pktLineReader } from "../protocol/pkt-line-codec.js";
import { demuxSideband } from "../protocol/sideband.js";
import type { ProgressInfo } from "../protocol/types.js";
import { parseProgressMessage, verifyPackHeader } from "../streams/pack-receiver.js";
import { ClientProtocolSession } from "../streams/protocol-session.js";
import { createGitStreamFromPort, type PortGitStreamOptions } from "./port-git-stream.js";

/**
 * Options for P2P fetch operation.
 */
export interface P2PFetchOptions {
  /** Repository path (used in protocol header) */
  repoPath?: string;
  /** Peer identifier (used in protocol header) */
  peerId?: string;
  /** Object IDs the client already has (for negotiation) */
  localHaves?: string[];
  /** Progress callback */
  onProgress?: (info: ProgressInfo) => void;
  /** Raw progress message callback */
  onProgressMessage?: (message: string) => void;
  /** Port stream options */
  portOptions?: PortGitStreamOptions;
}

/**
 * Result of P2P fetch operation.
 */
export interface P2PFetchResult {
  /** Remote refs (name → objectId) */
  refs: Map<string, string>;
  /** Pack data (null if already up-to-date) */
  packData: Uint8Array | null;
  /** Server capabilities */
  capabilities: Set<string>;
  /** Total bytes received */
  bytesReceived: number;
  /** Progress messages */
  progressMessages: string[];
}

/**
 * Fetch objects from a peer over MessagePort.
 *
 * This implements the client side of git-upload-pack protocol.
 * The peer should be running a corresponding server handler.
 *
 * @param port - MessagePortLike for communication
 * @param options - Fetch options
 * @returns Fetch result with refs and pack data
 *
 * @example
 * ```typescript
 * const channel = new MessageChannel();
 *
 * // Run client and server concurrently
 * const [fetchResult] = await Promise.all([
 *   // Client side
 *   fetchFromPeer(wrapNativePort(channel.port1), {
 *     localHaves: ['abc123...'],
 *     onProgress: (info) => console.log(info),
 *   }),
 *   // Server side
 *   serveUploadPack(wrapNativePort(channel.port2), repository),
 * ]);
 *
 * console.log('Fetched refs:', fetchResult.refs);
 * ```
 */
export async function fetchFromPeer(
  port: MessagePortLike,
  options: P2PFetchOptions = {},
): Promise<P2PFetchResult> {
  const {
    repoPath = "/repo.git",
    peerId = "peer",
    localHaves = [],
    onProgress,
    onProgressMessage,
    portOptions,
  } = options;

  const { stream, closePort: _closePort } = createGitStreamFromPort(port, portOptions);

  const session = new ClientProtocolSession(stream, {
    service: "git-upload-pack",
    protocolVersion: "0", // V0 is simpler for P2P
  });

  const progressMessages: string[] = [];

  try {
    // PHASE 1: Connect and get ref advertisement
    await session.sendHeader(repoPath, peerId);
    const { refs, capabilities } = await session.readRefAdvertisement();

    // Build refs map
    const refsMap = new Map<string, string>();
    for (const ref of refs) {
      refsMap.set(ref.name, ref.objectId);
    }

    // Check for empty repository
    if (refs.length === 0) {
      return {
        refs: refsMap,
        packData: null,
        capabilities,
        bytesReceived: 0,
        progressMessages,
      };
    }

    // PHASE 2: Determine what we need
    const haveSet = new Set(localHaves);
    const wants = refs.filter((r) => !haveSet.has(r.objectId)).map((r) => r.objectId);

    // Deduplicate wants
    const uniqueWants = [...new Set(wants)];

    if (uniqueWants.length === 0) {
      // Already up to date - send flush to signal no wants, then close
      await session.writeFlush();
      await session.flush();
      await session.close();
      return {
        refs: refsMap,
        packData: null,
        capabilities,
        bytesReceived: 0,
        progressMessages,
      };
    }

    // PHASE 3: Send wants with capabilities
    const capsToRequest = negotiateFetchCapabilities(capabilities);
    const firstWant = `want ${uniqueWants[0]} ${capsToRequest}\n`;
    await session.writePacket(firstWant);

    for (let i = 1; i < uniqueWants.length; i++) {
      await session.writePacket(`want ${uniqueWants[i]}\n`);
    }
    await session.writeFlush();

    // PHASE 4: Send haves (for negotiation)
    for (const have of localHaves) {
      await session.writePacket(`have ${have}\n`);
    }
    await session.writePacket("done\n");
    await session.flush();

    // PHASE 5: Receive response
    const useSideband = capabilities.has(CAPABILITY_SIDE_BAND_64K) || capabilities.has("side-band");

    const chunks: Uint8Array[] = [];
    let bytesReceived = 0;

    // Read packets
    const packets = pktLineReader(stream.input);

    if (useSideband) {
      // Demux sideband
      for await (const msg of demuxSideband(packets)) {
        if (msg.channel === 1) {
          // Data channel
          chunks.push(msg.data);
          bytesReceived += msg.data.length;
        } else if (msg.channel === 2) {
          // Progress channel
          const message = new TextDecoder().decode(msg.data);
          progressMessages.push(message);
          if (onProgressMessage) {
            onProgressMessage(message);
          }
          if (onProgress) {
            const parsed = parseProgressMessage(message);
            if (parsed) {
              onProgress(parsed);
            }
          }
        }
      }
    } else {
      // No sideband - read NAK/ACK then raw pack data
      for await (const packet of packets) {
        if (packet.type === "flush") {
          continue;
        }
        if (packet.type === "data" && packet.data) {
          const str = new TextDecoder().decode(packet.data);
          if (str.startsWith("NAK") || str.startsWith("ACK")) {
            // Skip negotiation responses
            continue;
          }
          // This is pack data
          chunks.push(packet.data);
          bytesReceived += packet.data.length;
        }
      }
    }

    // Combine pack data
    const packData = concatBytes(chunks);

    // Verify pack header
    if (packData.length > 0) {
      const verify = verifyPackHeader(packData);
      if (!verify.valid) {
        throw new Error(`Invalid pack data: ${verify.error}`);
      }
    }

    return {
      refs: refsMap,
      packData: packData.length > 0 ? packData : null,
      capabilities,
      bytesReceived,
      progressMessages,
    };
  } finally {
    try {
      await session.close();
    } catch {
      // Ignore close errors
    }
    try {
      await stream.close();
    } catch {
      // Ignore close errors
    }
  }
}

/**
 * Options for P2P push operation.
 */
export interface P2PPushOptions {
  /** Repository path (used in protocol header) */
  repoPath?: string;
  /** Peer identifier (used in protocol header) */
  peerId?: string;
  /** Ref updates to push */
  updates: Array<{
    refName: string;
    oldOid: string;
    newOid: string;
  }>;
  /** Pack data to send */
  packData: Uint8Array;
  /** Progress callback */
  onProgress?: (info: ProgressInfo) => void;
  /** Raw progress message callback */
  onProgressMessage?: (message: string) => void;
  /** Port stream options */
  portOptions?: PortGitStreamOptions;
}

/**
 * Result of P2P push operation.
 */
export interface P2PPushResult {
  /** Whether the push was successful */
  success: boolean;
  /** Server capabilities */
  capabilities: Set<string>;
  /** Unpack status message */
  unpackStatus: string;
  /** Status of each ref update */
  refUpdates: Map<string, { ok: boolean; message?: string }>;
  /** Error messages */
  errors: string[];
}

/**
 * Push objects to a peer over MessagePort.
 *
 * This implements the client side of git-receive-pack protocol.
 * The peer should be running a corresponding server handler.
 *
 * @param port - MessagePortLike for communication
 * @param options - Push options
 * @returns Push result with status
 *
 * @example
 * ```typescript
 * const channel = new MessageChannel();
 *
 * // Run client and server concurrently
 * const [pushResult] = await Promise.all([
 *   // Client side
 *   pushToPeer(wrapNativePort(channel.port1), {
 *     updates: [
 *       { refName: 'refs/heads/main', oldOid: 'abc...', newOid: 'def...' }
 *     ],
 *     packData: packFile,
 *   }),
 *   // Server side
 *   serveReceivePack(wrapNativePort(channel.port2), repository),
 * ]);
 *
 * console.log('Push successful:', pushResult.success);
 * ```
 */
export async function pushToPeer(
  port: MessagePortLike,
  options: P2PPushOptions,
): Promise<P2PPushResult> {
  const {
    repoPath = "/repo.git",
    peerId = "peer",
    updates,
    packData,
    onProgress,
    onProgressMessage,
    portOptions,
  } = options;

  const { stream, closePort: _closePort } = createGitStreamFromPort(port, portOptions);

  const session = new ClientProtocolSession(stream, {
    service: "git-receive-pack",
    protocolVersion: "0",
  });

  const errors: string[] = [];
  const refUpdates = new Map<string, { ok: boolean; message?: string }>();

  try {
    // PHASE 1: Connect and get ref advertisement
    await session.sendHeader(repoPath, peerId);
    const { capabilities } = await session.readRefAdvertisement();

    // PHASE 2: Send ref updates
    const capsToRequest = negotiatePushCapabilities(capabilities);

    for (let i = 0; i < updates.length; i++) {
      const { oldOid, newOid, refName } = updates[i];
      const caps = i === 0 ? ` ${capsToRequest}` : "";
      await session.writePacket(`${oldOid} ${newOid} ${refName}${caps}\n`);
    }
    await session.writeFlush();

    // PHASE 3: Send pack data
    await stream.output.write(packData);
    await stream.output.flush();

    // PHASE 4: Read status report
    const useSideband = capabilities.has(CAPABILITY_SIDE_BAND_64K) || capabilities.has("side-band");
    let unpackStatus = "ok";

    const packets = pktLineReader(stream.input);

    if (useSideband) {
      for await (const msg of demuxSideband(packets)) {
        if (msg.channel === 1) {
          // Status channel - parse report-status
          const line = new TextDecoder().decode(msg.data).trim();
          parseStatusLine(line, refUpdates, (status) => {
            unpackStatus = status;
          });
        } else if (msg.channel === 2 && onProgressMessage) {
          const message = new TextDecoder().decode(msg.data);
          onProgressMessage(message);
          if (onProgress) {
            const parsed = parseProgressMessage(message);
            if (parsed) {
              onProgress(parsed);
            }
          }
        }
      }
    } else {
      for await (const packet of session.readPackets()) {
        if (packet.type === "flush") {
          break;
        }
        if (packet.type === "data" && packet.data) {
          parseStatusLine(packet.data, refUpdates, (status) => {
            unpackStatus = status;
          });
        }
      }
    }

    // Determine overall success
    const success =
      unpackStatus === "ok" && Array.from(refUpdates.values()).every((s) => s.ok !== false);

    return {
      success,
      capabilities,
      unpackStatus,
      refUpdates,
      errors,
    };
  } finally {
    try {
      await session.close();
    } catch {
      // Ignore close errors
    }
    try {
      await stream.close();
    } catch {
      // Ignore close errors
    }
  }
}

/**
 * Negotiate fetch capabilities with server.
 */
function negotiateFetchCapabilities(serverCaps: Set<string>): string {
  const wanted = [CAPABILITY_OFS_DELTA, CAPABILITY_SIDE_BAND_64K, "thin-pack"];
  const negotiated = wanted.filter((c) => serverCaps.has(c));
  return negotiated.join(" ");
}

/**
 * Negotiate push capabilities with server.
 */
function negotiatePushCapabilities(serverCaps: Set<string>): string {
  const wanted = ["report-status", CAPABILITY_SIDE_BAND_64K, "delete-refs"];
  const negotiated = wanted.filter((c) => serverCaps.has(c));
  return negotiated.join(" ");
}

/**
 * Parse a status line from push response.
 */
function parseStatusLine(
  line: string,
  refUpdates: Map<string, { ok: boolean; message?: string }>,
  setUnpackStatus: (status: string) => void,
): void {
  if (line.startsWith("unpack ")) {
    setUnpackStatus(line.slice(7));
  } else if (line.startsWith("ok ")) {
    const refName = line.slice(3).trim();
    refUpdates.set(refName, { ok: true });
  } else if (line.startsWith("ng ")) {
    const rest = line.slice(3);
    const spaceIdx = rest.indexOf(" ");
    if (spaceIdx !== -1) {
      const refName = rest.slice(0, spaceIdx);
      const message = rest.slice(spaceIdx + 1);
      refUpdates.set(refName, { ok: false, message });
    } else {
      refUpdates.set(rest.trim(), { ok: false });
    }
  }
}

/**
 * Concatenate byte arrays.
 */
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

export type { PortGitStreamOptions, PortGitStreamResult } from "./port-git-stream.js";
// Re-export port-git-stream for convenience
export { createGitStreamFromPort, createGitStreamPair } from "./port-git-stream.js";
