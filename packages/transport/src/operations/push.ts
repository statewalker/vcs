/**
 * High-level push operation.
 *
 * Coordinates the complete push workflow:
 * 1. Connect to remote (receive-pack)
 * 2. Discover refs
 * 3. Build ref update commands
 * 4. Create pack with objects to send
 * 5. Send commands + pack
 * 6. Parse report-status response
 *
 * Based on JGit's PushProcess.java and BasePackPushConnection.java
 */

import { openReceivePack } from "../connection/connection-factory.js";
import type { Credentials } from "../connection/types.js";
import {
  buildPushRequest,
  buildRefUpdates,
  generatePushRequestPackets,
  type RefUpdate,
} from "../negotiation/push-negotiator.js";
import { CAPABILITY_SIDE_BAND_64K } from "../protocol/constants.js";
import { collectPackets, pktLineReader, pktLineWriter } from "../protocol/pkt-line-codec.js";
import { type PushReportStatus, parseReportStatus } from "../protocol/report-status.js";
import { demuxSideband } from "../protocol/sideband.js";
import type { Packet, ProgressInfo } from "../protocol/types.js";

/**
 * Object to include in the push pack.
 */
export interface PushObject {
  /** Object ID (40-char hex string) */
  id: string;
  /** Object type (1=commit, 2=tree, 3=blob, 4=tag) */
  type: number;
  /** Uncompressed object content */
  content: Uint8Array;
}

/**
 * Options for push operation.
 */
export interface PushOptions {
  /** Remote URL to push to */
  url: string;
  /** Refspecs to push (e.g., "refs/heads/main:refs/heads/main") */
  refspecs: string[];
  /** Authentication credentials */
  auth?: Credentials;
  /** Custom HTTP headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Force push (ignore fast-forward check) */
  force?: boolean;
  /** Atomic push (all-or-nothing) */
  atomic?: boolean;
  /** Progress callback */
  onProgress?: (info: ProgressInfo) => void;
  /** Raw progress message callback */
  onProgressMessage?: (message: string) => void;
  /**
   * Get local ref value.
   * Returns the object ID (hex) for the ref, or undefined if not found.
   */
  getLocalRef: (refName: string) => Promise<string | undefined>;
  /**
   * Get objects to send.
   * Should return all objects reachable from newIds but not from oldIds.
   * This is typically the objects in the commits being pushed.
   */
  getObjectsToPush: (newIds: string[], oldIds: string[]) => AsyncIterable<PushObject>;
  /**
   * Pack data to send (alternative to getObjectsToPush).
   * If provided, this pre-built pack is sent instead of building one.
   */
  packData?: Uint8Array;
}

/**
 * Result of a push operation.
 */
export interface PushResult {
  /** Whether the push was successful */
  ok: boolean;
  /** Unpack status message */
  unpackStatus: string;
  /** Status of each ref update */
  updates: Map<string, { ok: boolean; message?: string }>;
  /** Total bytes sent */
  bytesSent: number;
  /** Number of objects sent */
  objectCount: number;
}

/**
 * Push refs to a remote repository.
 */
export async function push(options: PushOptions): Promise<PushResult> {
  const {
    url,
    refspecs,
    auth,
    headers,
    timeout,
    force = false,
    atomic = false,
    onProgressMessage,
    getLocalRef,
    getObjectsToPush,
    packData: prebuiltPack,
  } = options;

  // Open receive-pack connection
  const connection = await openReceivePack(url, {
    auth,
    headers,
    timeout,
  });

  try {
    // Discover remote refs
    const advertisement = await connection.discoverRefs();

    // Build local refs map from refspecs
    const localRefs = new Map<string, string>();
    for (const refspec of refspecs) {
      const src = parseRefspecSource(refspec);
      if (src) {
        const value = await getLocalRef(src);
        if (value) {
          localRefs.set(src, value);
        }
      }
    }

    // Build ref updates
    const updates = buildRefUpdates(refspecs, localRefs, advertisement, { force });

    if (updates.length === 0) {
      // Nothing to push
      return {
        ok: true,
        unpackStatus: "ok",
        updates: new Map(),
        bytesSent: 0,
        objectCount: 0,
      };
    }

    // Build push request
    const request = buildPushRequest(updates, advertisement.capabilities, { atomic });

    // Collect objects to send
    const newIds = updates.filter((u) => u.newId !== "0".repeat(40)).map((u) => u.newId);
    const oldIds = updates.filter((u) => u.oldId !== "0".repeat(40)).map((u) => u.oldId);

    // Build pack data
    let packData: Uint8Array;
    let objectCount = 0;

    if (prebuiltPack) {
      packData = prebuiltPack;
      objectCount = parsePackObjectCount(prebuiltPack);
    } else {
      const packResult = await buildPushPack(getObjectsToPush(newIds, oldIds));
      packData = packResult.packData;
      objectCount = packResult.objectCount;
    }

    // Generate request packets
    const requestPackets = generatePushRequestPackets(request);

    // Collect pkt-line encoded commands
    const commandsData = await collectPackets(pktLineWriter(requestPackets));

    // Combine commands and pack data for sending
    const fullRequestBody = concatBytes(commandsData, packData);

    // Send raw bytes - the commands are already pkt-line encoded
    if (connection.sendRaw) {
      await connection.sendRaw(fullRequestBody);
    } else {
      // Fallback: use send with wrapped packets (may cause double-encoding!)
      await connection.send(wrapAsPackets(fullRequestBody));
    }

    // Receive and parse response
    const responsePackets = connection.receive();
    let reportStatus: PushReportStatus;

    if (request.capabilities.includes(CAPABILITY_SIDE_BAND_64K)) {
      // Collect response with sideband demux
      // Channel 1 data contains nested pkt-line encoded report-status
      const collectedBytes: Uint8Array[] = [];
      for await (const msg of demuxSideband(responsePackets)) {
        if (msg.channel === 1) {
          // Data channel - collect raw bytes (still pkt-line encoded)
          collectedBytes.push(msg.data);
        } else if (msg.channel === 2 && onProgressMessage) {
          const message = new TextDecoder().decode(msg.data);
          onProgressMessage(message);
        }
        // Channel 3 (error) throws in demuxSideband
      }
      // Decode nested pkt-lines from sideband data
      const sidebandData = concatBytes(...collectedBytes);
      const statusPackets = pktLineReader(arrayToAsyncByteIterable([sidebandData]));
      reportStatus = await parseReportStatus(statusPackets);
    } else {
      reportStatus = await parseReportStatus(responsePackets);
    }

    // Convert to result format
    const resultUpdates = new Map<string, { ok: boolean; message?: string }>();
    for (const ref of reportStatus.refUpdates) {
      resultUpdates.set(ref.refName, {
        ok: ref.ok,
        message: ref.message,
      });
    }

    return {
      ok: reportStatus.ok,
      unpackStatus: reportStatus.unpackOk ? "ok" : reportStatus.unpackMessage || "failed",
      updates: resultUpdates,
      bytesSent: fullRequestBody.length,
      objectCount,
    };
  } finally {
    await connection.close();
  }
}

/**
 * Parse the source from a refspec.
 */
function parseRefspecSource(refspec: string): string | undefined {
  let spec = refspec;

  // Remove force prefix
  if (spec.startsWith("+")) {
    spec = spec.slice(1);
  }

  const colonIdx = spec.indexOf(":");
  if (colonIdx === -1) {
    return spec || undefined;
  }

  const src = spec.slice(0, colonIdx);
  return src || undefined;
}

/**
 * Parse object count from pack header.
 */
function parsePackObjectCount(packData: Uint8Array): number {
  if (packData.length < 12) {
    return 0;
  }

  // Pack header: "PACK" (4 bytes) + version (4 bytes) + object count (4 bytes)
  const view = new DataView(packData.buffer, packData.byteOffset, packData.byteLength);
  return view.getUint32(8, false); // Big-endian
}

/**
 * Build a pack from objects.
 */
async function buildPushPack(
  objects: AsyncIterable<PushObject>,
): Promise<{ packData: Uint8Array; objectCount: number }> {
  // Collect all objects
  const objectList: PushObject[] = [];
  for await (const obj of objects) {
    objectList.push(obj);
  }

  if (objectList.length === 0) {
    // Empty pack
    return {
      packData: createEmptyPack(),
      objectCount: 0,
    };
  }

  // Build pack using simple format (no deltas for now)
  const chunks: Uint8Array[] = [];

  // Pack header: "PACK" + version 2 + object count
  const header = new Uint8Array(12);
  header[0] = 0x50; // P
  header[1] = 0x41; // A
  header[2] = 0x43; // C
  header[3] = 0x4b; // K
  header[4] = 0x00;
  header[5] = 0x00;
  header[6] = 0x00;
  header[7] = 0x02; // Version 2
  // Object count (big-endian)
  const count = objectList.length;
  header[8] = (count >>> 24) & 0xff;
  header[9] = (count >>> 16) & 0xff;
  header[10] = (count >>> 8) & 0xff;
  header[11] = count & 0xff;
  chunks.push(header);

  // Write each object
  for (const obj of objectList) {
    // Object header: type and size in variable-length encoding
    const objHeader = encodePackObjectHeader(obj.type, obj.content.length);
    chunks.push(objHeader);

    // Compressed content (zlib)
    const compressed = await compressData(obj.content);
    chunks.push(compressed);
  }

  // Concatenate and compute checksum
  const packWithoutChecksum = concatBytes(...chunks);
  const checksum = await computeSha1(packWithoutChecksum);

  return {
    packData: concatBytes(packWithoutChecksum, checksum),
    objectCount: objectList.length,
  };
}

/**
 * Create an empty pack file.
 */
function createEmptyPack(): Uint8Array {
  // Pack header with 0 objects
  const header = new Uint8Array([
    0x50,
    0x41,
    0x43,
    0x4b, // "PACK"
    0x00,
    0x00,
    0x00,
    0x02, // Version 2
    0x00,
    0x00,
    0x00,
    0x00, // 0 objects
  ]);

  // SHA-1 checksum of empty pack header
  // Pre-computed: SHA-1 of the header above
  const checksum = new Uint8Array([
    0x02, 0x9d, 0x08, 0x82, 0x3b, 0xd8, 0xa8, 0xea, 0xb5, 0x10, 0xad, 0x6a, 0xc7, 0x5c, 0x82, 0x3c,
    0xfd, 0x3e, 0xd3, 0x1e,
  ]);

  return concatBytes(header, checksum);
}

/**
 * Encode pack object header.
 */
function encodePackObjectHeader(type: number, size: number): Uint8Array {
  const bytes: number[] = [];

  // First byte: (type << 4) | (size & 0x0f), MSB set if more bytes follow
  let c = (type << 4) | (size & 0x0f);
  size >>>= 4;

  while (size > 0) {
    bytes.push(c | 0x80);
    c = size & 0x7f;
    size >>>= 7;
  }

  bytes.push(c);
  return new Uint8Array(bytes);
}

/**
 * Compress data using zlib.
 */
async function compressData(data: Uint8Array): Promise<Uint8Array> {
  // Use CompressionStream if available (modern browsers/Node.js)
  if (typeof CompressionStream !== "undefined") {
    const stream = new CompressionStream("deflate");
    const writer = stream.writable.getWriter();
    // Create a copy to avoid type issues with SharedArrayBuffer
    const dataCopy = new Uint8Array(data);
    writer.write(dataCopy);
    writer.close();

    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    return concatBytes(...chunks);
  }

  // Fallback: throw error
  throw new Error(
    "Compression not available. Please use a runtime with CompressionStream support.",
  );
}

/**
 * Compute SHA-1 hash.
 */
async function computeSha1(data: Uint8Array): Promise<Uint8Array> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    // Create a copy to avoid type issues with SharedArrayBuffer
    const dataCopy = new Uint8Array(data);
    const hash = await crypto.subtle.digest("SHA-1", dataCopy);
    return new Uint8Array(hash);
  }

  throw new Error("SHA-1 not available. Please use a runtime with crypto.subtle support.");
}

/**
 * Concatenate byte arrays.
 */
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Wrap raw bytes as a sequence of packets for sending.
 * This creates a single data packet containing all the bytes.
 */
async function* wrapAsPackets(data: Uint8Array): AsyncGenerator<Packet> {
  // Send as a single data packet - the connection will handle encoding
  yield { type: "data", data };
}

/**
 * Convert array to async iterable.
 */
async function* _arrayToAsyncIterable<T>(arr: T[]): AsyncGenerator<T> {
  for (const item of arr) {
    yield item;
  }
}

/**
 * Convert array of byte arrays to async iterable.
 */
async function* arrayToAsyncByteIterable(arr: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const item of arr) {
    yield item;
  }
}

/**
 * Push refs and throw on failure.
 */
export async function pushOrThrow(options: PushOptions): Promise<PushResult> {
  const result = await push(options);

  if (!result.ok) {
    const failures = Array.from(result.updates.entries())
      .filter(([, status]) => !status.ok)
      .map(([ref, status]) => `${ref}: ${status.message || "rejected"}`);

    const message =
      failures.length > 0
        ? `Push failed:\n${failures.join("\n")}`
        : `Push failed: ${result.unpackStatus}`;

    throw new Error(message);
  }

  return result;
}

/**
 * Get list of refs that would be pushed.
 * Useful for dry-run/preview.
 */
export async function getPushRefs(
  url: string,
  refspecs: string[],
  getLocalRef: (refName: string) => Promise<string | undefined>,
  options: Pick<PushOptions, "auth" | "headers" | "timeout" | "force"> = {},
): Promise<RefUpdate[]> {
  const connection = await openReceivePack(url, {
    auth: options.auth,
    headers: options.headers,
    timeout: options.timeout,
  });

  try {
    const advertisement = await connection.discoverRefs();

    // Build local refs map
    const localRefs = new Map<string, string>();
    for (const refspec of refspecs) {
      const src = parseRefspecSource(refspec);
      if (src) {
        const value = await getLocalRef(src);
        if (value) {
          localRefs.set(src, value);
        }
      }
    }

    return buildRefUpdates(refspecs, localRefs, advertisement, { force: options.force });
  } finally {
    await connection.close();
  }
}
