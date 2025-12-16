/**
 * Upload pack handler for git-upload-pack service.
 *
 * Protocol-independent implementation that handles fetch/clone operations
 * by generating pack files containing requested objects.
 *
 * Based on JGit's UploadPack.java
 */

import { compressBlock, sha1 } from "@webrun-vcs/utils";
import {
  CAPABILITY_AGENT,
  CAPABILITY_NO_PROGRESS,
  CAPABILITY_OFS_DELTA,
  CAPABILITY_SHALLOW,
  CAPABILITY_SIDE_BAND_64K,
  CAPABILITY_SYMREF,
  PACKET_DONE,
  PACKET_HAVE,
  PACKET_NAK,
  PACKET_WANT,
  SIDEBAND_DATA,
  SIDEBAND_PROGRESS,
  ZERO_ID,
} from "../protocol/constants.js";
import {
  encodeFlush,
  encodePacket,
  packetDataToString,
  pktLineReader,
} from "../protocol/pkt-line-codec.js";
import type {
  AdvertiseOptions,
  ObjectId,
  RepositoryAccess,
  UploadPackHandler,
  UploadPackOptions,
  UploadPackRequest,
} from "./types.js";

const textEncoder = new TextEncoder();

/**
 * Default capabilities for upload-pack.
 */
const DEFAULT_CAPABILITIES = [
  CAPABILITY_SIDE_BAND_64K,
  CAPABILITY_OFS_DELTA,
  CAPABILITY_NO_PROGRESS,
  CAPABILITY_SHALLOW,
];

/**
 * Agent string for capability advertisement.
 */
const AGENT_STRING = "webrun-vcs/1.0";

/**
 * Maximum sideband payload size.
 * 65520 - 5 (pkt-line header + channel byte)
 */
const MAX_SIDEBAND_DATA = 65515;

/**
 * Create an upload pack handler.
 *
 * @param options - Handler options
 * @returns Upload pack handler
 */
export function createUploadPackHandler(options: UploadPackOptions): UploadPackHandler {
  const { repository } = options;

  return {
    async *advertise(advertiseOptions?: AdvertiseOptions): AsyncIterable<Uint8Array> {
      const { includeServiceAnnouncement, serviceName, extraCapabilities } = advertiseOptions ?? {};

      // Service announcement for HTTP smart protocol
      if (includeServiceAnnouncement && serviceName) {
        yield encodePacket(`# service=${serviceName}\n`);
        yield encodeFlush();
      }

      // Collect refs
      const refs: Array<{ name: string; objectId: ObjectId }> = [];
      for await (const ref of repository.listRefs()) {
        refs.push({ name: ref.name, objectId: ref.objectId });
      }

      // Get HEAD for symref capability
      const head = await repository.getHead();

      // Build capabilities string
      const capabilities = buildServerCapabilities({
        symrefHead: head?.target,
        extraCapabilities,
      });

      // Output refs with capabilities on first line
      let isFirst = true;
      for (const ref of refs) {
        if (isFirst) {
          yield encodePacket(`${ref.objectId} ${ref.name}\0${capabilities}\n`);
          isFirst = false;
        } else {
          yield encodePacket(`${ref.objectId} ${ref.name}\n`);
        }
      }

      // Empty repository case - send zero-id with capabilities
      if (refs.length === 0) {
        yield encodePacket(`${ZERO_ID} capabilities^{}\0${capabilities}\n`);
      }

      yield encodeFlush();
    },

    async *process(input: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
      // Parse the request
      const request = await parseUploadPackRequest(input);

      if (request.wants.length === 0) {
        // Nothing requested, just send flush
        yield encodeFlush();
        return;
      }

      // Send NAK (we don't implement multi-ack negotiation yet)
      yield encodePacket(`${PACKET_NAK}\n`);

      // Check if client requested sideband
      const useSideband = request.capabilities.has(CAPABILITY_SIDE_BAND_64K);

      // Generate pack data
      const packData = await buildPack(repository, request.wants, request.haves);

      if (useSideband) {
        // Send progress via sideband channel 2
        const progressMsg = textEncoder.encode("Enumerating objects: done.\n");
        yield encodeSidebandPacket(SIDEBAND_PROGRESS, progressMsg);

        // Send pack data via sideband channel 1 in chunks
        for (let offset = 0; offset < packData.length; offset += MAX_SIDEBAND_DATA) {
          const chunk = packData.subarray(
            offset,
            Math.min(offset + MAX_SIDEBAND_DATA, packData.length),
          );
          yield encodeSidebandPacket(SIDEBAND_DATA, chunk);
        }
      } else {
        // Send pack data directly
        yield packData;
      }

      yield encodeFlush();
    },
  };
}

/**
 * Build server capabilities string.
 */
function buildServerCapabilities(options: {
  symrefHead?: string;
  extraCapabilities?: string[];
}): string {
  const caps = [...DEFAULT_CAPABILITIES];

  // Add symref for HEAD if available
  if (options.symrefHead) {
    caps.push(`${CAPABILITY_SYMREF}HEAD:${options.symrefHead}`);
  }

  // Add agent
  caps.push(`${CAPABILITY_AGENT}${AGENT_STRING}`);

  // Add extra capabilities
  if (options.extraCapabilities) {
    caps.push(...options.extraCapabilities);
  }

  return caps.join(" ");
}

/**
 * Parse upload-pack request from input stream.
 */
export async function parseUploadPackRequest(
  input: AsyncIterable<Uint8Array>,
): Promise<UploadPackRequest> {
  const wants: ObjectId[] = [];
  const haves: ObjectId[] = [];
  const capabilities = new Set<string>();
  let done = false;
  let depth: number | undefined;
  let filter: string | undefined;
  let isFirstWant = true;

  const packets = pktLineReader(input);

  for await (const packet of packets) {
    if (packet.type === "flush") {
      // Flush packet - may continue with more data or end
      continue;
    }

    if (packet.type !== "data" || !packet.data) {
      continue;
    }

    const line = packetDataToString(packet);

    if (line.startsWith(PACKET_WANT)) {
      // Parse want line: "want <oid> [capabilities]"
      const rest = line.slice(PACKET_WANT.length);

      if (isFirstWant) {
        // First want line contains capabilities after space
        const spaceIdx = rest.indexOf(" ");
        if (spaceIdx !== -1) {
          wants.push(rest.slice(0, spaceIdx));
          parseCapabilitiesInto(rest.slice(spaceIdx + 1), capabilities);
        } else {
          wants.push(rest.trim());
        }
        isFirstWant = false;
      } else {
        wants.push(rest.trim());
      }
    } else if (line.startsWith(PACKET_HAVE)) {
      haves.push(line.slice(PACKET_HAVE.length).trim());
    } else if (line === PACKET_DONE || line.startsWith(PACKET_DONE)) {
      done = true;
      break;
    } else if (line.startsWith("deepen ")) {
      depth = parseInt(line.slice(7), 10);
    } else if (line.startsWith("filter ")) {
      filter = line.slice(7);
    }
  }

  return { wants, haves, capabilities, done, depth, filter };
}

/**
 * Parse capabilities from a string into a Set.
 */
function parseCapabilitiesInto(capStr: string, caps: Set<string>): void {
  for (const cap of capStr.split(" ")) {
    if (cap) {
      caps.add(cap);
    }
  }
}

/**
 * Build a pack file from wanted objects.
 */
async function buildPack(
  repository: RepositoryAccess,
  wants: ObjectId[],
  haves: ObjectId[],
): Promise<Uint8Array> {
  // Collect objects to send
  const objects: Array<{ id: ObjectId; type: number; content: Uint8Array }> = [];

  for await (const obj of repository.walkObjects(wants, haves)) {
    objects.push({
      id: obj.id,
      type: obj.type,
      content: obj.content,
    });
  }

  // Build pack file
  return createPackData(objects);
}

/**
 * Create pack file data from objects.
 *
 * Pack format:
 * - Header: "PACK" + version (4 bytes) + object count (4 bytes)
 * - Objects: variable-length header + compressed content
 * - Footer: SHA-1 checksum of everything
 */
async function createPackData(
  objects: Array<{ id: string; type: number; content: Uint8Array }>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  // Pack header
  const header = new Uint8Array(12);
  header.set(textEncoder.encode("PACK"), 0);
  // Version 2
  header[4] = 0;
  header[5] = 0;
  header[6] = 0;
  header[7] = 2;
  // Object count (big-endian)
  const count = objects.length;
  header[8] = (count >> 24) & 0xff;
  header[9] = (count >> 16) & 0xff;
  header[10] = (count >> 8) & 0xff;
  header[11] = count & 0xff;
  chunks.push(header);

  // Encode each object
  for (const obj of objects) {
    const encoded = await encodePackObject(obj.type, obj.content);
    chunks.push(encoded);
  }

  // Combine all chunks
  const packWithoutChecksum = concatBytes(chunks);

  // Compute SHA-1 checksum
  const checksum = await computeSha1(packWithoutChecksum);

  // Combine pack + checksum
  return concatBytes([packWithoutChecksum, checksum]);
}

/**
 * Encode a single object for pack file.
 *
 * Object header format:
 * - First byte: (type << 4) | (size & 0x0f), MSB set if more size bytes follow
 * - Additional bytes: 7 bits of size each, MSB set if more follow
 * - Content: deflate-compressed data
 */
async function encodePackObject(type: number, content: Uint8Array): Promise<Uint8Array> {
  // Encode variable-length header
  const headerBytes: number[] = [];
  let size = content.length;

  // First byte: type (3 bits) and low 4 bits of size
  let firstByte = ((type & 0x07) << 4) | (size & 0x0f);
  size >>= 4;

  if (size > 0) {
    firstByte |= 0x80; // More bytes follow
  }
  headerBytes.push(firstByte);

  // Additional size bytes (7 bits each)
  while (size > 0) {
    let nextByte = size & 0x7f;
    size >>= 7;
    if (size > 0) {
      nextByte |= 0x80; // More bytes follow
    }
    headerBytes.push(nextByte);
  }

  // Compress content using deflate
  const compressed = await compressDeflate(content);

  // Combine header + compressed content
  const result = new Uint8Array(headerBytes.length + compressed.length);
  result.set(headerBytes, 0);
  result.set(compressed, headerBytes.length);

  return result;
}

/**
 * Compress data using deflate.
 * Uses the compression utilities from @webrun-vcs/utils.
 */
async function compressDeflate(data: Uint8Array): Promise<Uint8Array> {
  return compressBlock(data, { raw: false });
}

/**
 * Compute SHA-1 hash.
 */
async function computeSha1(data: Uint8Array): Promise<Uint8Array> {
  return sha1(data);
}

/**
 * Encode a sideband packet.
 */
function encodeSidebandPacket(channel: number, data: Uint8Array): Uint8Array {
  const length = data.length + 5; // 4 bytes length + 1 byte channel + payload
  const header = length.toString(16).padStart(4, "0");
  const result = new Uint8Array(length);
  result.set(textEncoder.encode(header), 0);
  result[4] = channel;
  result.set(data, 5);
  return result;
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
