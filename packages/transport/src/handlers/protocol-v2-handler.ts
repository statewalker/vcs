/**
 * Protocol V2 handler for git operations.
 *
 * Implements Git protocol version 2 which provides:
 * - Stateless operation (better for HTTP)
 * - Command-based structure (ls-refs, fetch, object-info)
 * - Section-based responses
 * - Better capability negotiation
 *
 * Based on JGit's UploadPack.serviceV2() and ProtocolV2Parser
 */

import { compressBlock, sha1 } from "@webrun-vcs/utils";
import {
  CAPABILITY_AGENT,
  CAPABILITY_INCLUDE_TAG,
  CAPABILITY_NO_PROGRESS,
  CAPABILITY_OFS_DELTA,
  CAPABILITY_SHALLOW,
  CAPABILITY_SIDE_BAND_64K,
  CAPABILITY_THIN_PACK,
  PACKET_DONE,
  PACKET_HAVE,
  PACKET_WANT,
  SIDEBAND_DATA,
  SIDEBAND_PROGRESS,
} from "../protocol/constants.js";
import {
  encodeDelim,
  encodeFlush,
  encodePacket,
  packetDataToString,
  pktLineReader,
} from "../protocol/pkt-line-codec.js";
import {
  computeShallowBoundary,
  formatShallowPacket,
  formatUnshallowPacket,
} from "./shallow-negotiation.js";
import type { ObjectId, RepositoryAccess } from "./types.js";

/**
 * Protocol V2 constants (local to this module).
 */
const PROTOCOL_VERSION_2 = "version 2";
const COMMAND_LS_REFS = "ls-refs";
const COMMAND_FETCH = "fetch";

// Section headers for V2 responses
const SECTION_ACKNOWLEDGMENTS = "acknowledgments";
const SECTION_SHALLOW_INFO = "shallow-info";
const SECTION_PACKFILE = "packfile";

// V2-specific capability strings
const CAPABILITY_REF_IN_WANT = "ref-in-want";
const CAPABILITY_SIDEBAND_ALL = "sideband-all";
const CAPABILITY_WAIT_FOR_DONE = "wait-for-done";
const CAPABILITY_FILTER = "filter";
const CAPABILITY_SERVER_OPTION = "server-option";

const textEncoder = new TextEncoder();

/**
 * Agent string for V2 capability advertisement.
 */
const AGENT_STRING = "webrun-vcs/1.0";

/**
 * Maximum sideband payload size.
 */
const MAX_SIDEBAND_DATA = 65515;

/**
 * Options for Protocol V2 handler.
 */
export interface ProtocolV2Options {
  repository: RepositoryAccess;
  allowFilter?: boolean;
  allowRefInWant?: boolean;
  allowSidebandAll?: boolean;
  allowWaitForDone?: boolean;
}

/**
 * ls-refs request parsed from client.
 */
export interface LsRefsRequest {
  /** Return peeled object IDs for tags */
  peel: boolean;
  /** Return symref targets */
  symrefs: boolean;
  /** Ref prefixes to filter by */
  refPrefixes: string[];
}

/**
 * Fetch request for Protocol V2.
 */
export interface FetchV2Request {
  wants: ObjectId[];
  wantRefs: string[];
  haves: ObjectId[];
  done: boolean;
  waitForDone: boolean;
  depth?: number;
  deepenSince?: number;
  deepenNots: string[];
  clientShallowCommits: Set<ObjectId>;
  filter?: string;
  capabilities: Set<string>;
  sidebandAll: boolean;
}

/**
 * Create a Protocol V2 handler.
 */
export function createProtocolV2Handler(options: ProtocolV2Options) {
  const { repository, allowFilter, allowRefInWant, allowSidebandAll, allowWaitForDone } = options;

  return {
    /**
     * Get V2 capability advertisement.
     */
    async *advertiseCapabilities(): AsyncIterable<Uint8Array> {
      yield encodePacket(`${PROTOCOL_VERSION_2}\n`);
      yield encodePacket(`${COMMAND_LS_REFS}\n`);

      // Build fetch capabilities
      const fetchCaps: string[] = [];
      if (allowFilter) {
        fetchCaps.push(CAPABILITY_FILTER);
      }
      if (allowRefInWant) {
        fetchCaps.push(CAPABILITY_REF_IN_WANT);
      }
      if (allowSidebandAll) {
        fetchCaps.push(CAPABILITY_SIDEBAND_ALL);
      }
      if (allowWaitForDone) {
        fetchCaps.push(CAPABILITY_WAIT_FOR_DONE);
      }
      fetchCaps.push(CAPABILITY_SHALLOW);

      const fetchCapString =
        fetchCaps.length > 0 ? `${COMMAND_FETCH}=${fetchCaps.join(" ")}` : COMMAND_FETCH;
      yield encodePacket(`${fetchCapString}\n`);

      yield encodePacket(`${CAPABILITY_SERVER_OPTION}\n`);
      yield encodePacket(`${CAPABILITY_AGENT}=${AGENT_STRING}\n`);
      yield encodeFlush();
    },

    /**
     * Handle ls-refs command.
     */
    async *handleLsRefs(input: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
      const request = await parseLsRefsRequest(input);

      for await (const ref of repository.listRefs()) {
        // Filter by prefix if specified
        if (request.refPrefixes.length > 0) {
          const matchesPrefix = request.refPrefixes.some((prefix) => ref.name.startsWith(prefix));
          if (!matchesPrefix) continue;
        }

        let line = `${ref.objectId} ${ref.name}`;

        // Add peeled info if requested and available
        if (request.peel && ref.peeledId) {
          line += ` peeled:${ref.peeledId}`;
        }

        // Add symref target if requested
        if (request.symrefs && ref.name === "HEAD") {
          const head = await repository.getHead();
          if (head?.target) {
            line += ` symref-target:${head.target}`;
          }
        }

        yield encodePacket(`${line}\n`);
      }

      yield encodeFlush();
    },

    /**
     * Handle fetch command.
     */
    async *handleFetch(input: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
      const request = await parseFetchV2Request(input, allowRefInWant ?? false);

      if (request.wants.length === 0 && request.wantRefs.length === 0) {
        yield encodeFlush();
        return;
      }

      // Resolve want-refs to object IDs
      const resolvedWants = [...request.wants];
      if (request.wantRefs.length > 0) {
        for await (const ref of repository.listRefs()) {
          if (request.wantRefs.includes(ref.name)) {
            resolvedWants.push(ref.objectId);
          }
        }
      }

      // Generate acknowledgments section
      const commonBases: ObjectId[] = [];
      for (const haveId of request.haves) {
        if (await repository.hasObject(haveId)) {
          commonBases.push(haveId);
        }
      }

      // Send acknowledgments section
      yield encodePacket(`${SECTION_ACKNOWLEDGMENTS}\n`);
      for (const ackId of commonBases) {
        yield encodePacket(`ACK ${ackId}\n`);
      }

      // Determine if we're ready to send pack
      const isReady = commonBases.length > 0 || request.done;

      if (isReady) {
        yield encodePacket("ready\n");
      } else if (!request.done && !request.waitForDone) {
        // Client needs to continue negotiation
        yield encodeDelim();
        return;
      }

      // Handle shallow info
      const hasShallowConstraints =
        (request.depth && request.depth > 0) ||
        (request.deepenSince && request.deepenSince > 0) ||
        request.deepenNots.length > 0;

      if (hasShallowConstraints) {
        const { shallowCommits, unshallowCommits } = await computeShallowBoundary(
          repository,
          resolvedWants,
          {
            depth: request.depth ?? 0,
            deepenSince: request.deepenSince ?? 0,
            deepenNots: request.deepenNots,
            deepenRelative: false,
            clientShallowCommits: request.clientShallowCommits,
          },
        );

        if (shallowCommits.length > 0 || unshallowCommits.length > 0) {
          yield encodePacket(`${SECTION_SHALLOW_INFO}\n`);
          for (const commitId of shallowCommits) {
            yield encodePacket(formatShallowPacket(commitId));
          }
          for (const commitId of unshallowCommits) {
            yield encodePacket(formatUnshallowPacket(commitId));
          }
        }
      }

      // Send packfile section
      yield encodeDelim();
      yield encodePacket(`${SECTION_PACKFILE}\n`);

      // Build pack
      const packData = await buildPackForV2(
        repository,
        resolvedWants,
        commonBases,
        request.capabilities.has(CAPABILITY_INCLUDE_TAG),
      );

      // Always use sideband for V2
      const progressMsg = textEncoder.encode("Enumerating objects: done.\n");
      yield encodeSidebandPacket(SIDEBAND_PROGRESS, progressMsg);

      for (let offset = 0; offset < packData.length; offset += MAX_SIDEBAND_DATA) {
        const chunk = packData.subarray(
          offset,
          Math.min(offset + MAX_SIDEBAND_DATA, packData.length),
        );
        yield encodeSidebandPacket(SIDEBAND_DATA, chunk);
      }

      yield encodeFlush();
    },

    /**
     * Process a V2 command.
     * Returns true if processing should continue (for bidirectional connections).
     */
    async *processCommand(
      command: string,
      input: AsyncIterable<Uint8Array>,
    ): AsyncIterable<Uint8Array> {
      if (command === `command=${COMMAND_LS_REFS}`) {
        yield* this.handleLsRefs(input);
      } else if (command === `command=${COMMAND_FETCH}`) {
        yield* this.handleFetch(input);
      } else {
        throw new Error(`Unknown V2 command: ${command}`);
      }
    },
  };
}

/**
 * Parse ls-refs request from input.
 */
async function parseLsRefsRequest(input: AsyncIterable<Uint8Array>): Promise<LsRefsRequest> {
  const request: LsRefsRequest = {
    peel: false,
    symrefs: false,
    refPrefixes: [],
  };

  const packets = pktLineReader(input);

  for await (const packet of packets) {
    if (packet.type === "flush" || packet.type === "delim") {
      break;
    }

    if (packet.type !== "data" || !packet.data) {
      continue;
    }

    const line = packetDataToString(packet);

    if (line === "peel") {
      request.peel = true;
    } else if (line === "symrefs") {
      request.symrefs = true;
    } else if (line.startsWith("ref-prefix ")) {
      request.refPrefixes.push(line.slice(11));
    }
  }

  return request;
}

/**
 * Parse V2 fetch request from input.
 */
async function parseFetchV2Request(
  input: AsyncIterable<Uint8Array>,
  allowRefInWant: boolean,
): Promise<FetchV2Request> {
  const request: FetchV2Request = {
    wants: [],
    wantRefs: [],
    haves: [],
    done: false,
    waitForDone: false,
    deepenNots: [],
    clientShallowCommits: new Set(),
    capabilities: new Set([CAPABILITY_SIDE_BAND_64K]),
    sidebandAll: false,
  };

  const packets = pktLineReader(input);
  let afterDelimiter = false;

  for await (const packet of packets) {
    if (packet.type === "flush") {
      break;
    }

    if (packet.type === "delim") {
      afterDelimiter = true;
      continue;
    }

    if (packet.type !== "data" || !packet.data) {
      continue;
    }

    const line = packetDataToString(packet);

    if (!afterDelimiter) {
      // Capability lines before delimiter
      if (line.startsWith("agent=")) {
        // Agent capability - ignore
      } else if (line.startsWith("server-option=")) {
        // Server option - store if needed
      }
      continue;
    }

    // Request arguments after delimiter
    if (line.startsWith(PACKET_WANT)) {
      request.wants.push(line.slice(PACKET_WANT.length));
    } else if (allowRefInWant && line.startsWith("want-ref ")) {
      request.wantRefs.push(line.slice(9));
    } else if (line.startsWith(PACKET_HAVE)) {
      request.haves.push(line.slice(PACKET_HAVE.length));
    } else if (line === PACKET_DONE) {
      request.done = true;
    } else if (line === "wait-for-done") {
      request.waitForDone = true;
    } else if (line === "thin-pack") {
      request.capabilities.add(CAPABILITY_THIN_PACK);
    } else if (line === "no-progress") {
      request.capabilities.add(CAPABILITY_NO_PROGRESS);
    } else if (line === "include-tag") {
      request.capabilities.add(CAPABILITY_INCLUDE_TAG);
    } else if (line === "ofs-delta") {
      request.capabilities.add(CAPABILITY_OFS_DELTA);
    } else if (line.startsWith("shallow ")) {
      request.clientShallowCommits.add(line.slice(8));
    } else if (line.startsWith("deepen ")) {
      request.depth = parseInt(line.slice(7), 10);
    } else if (line.startsWith("deepen-since ")) {
      request.deepenSince = parseInt(line.slice(13), 10);
    } else if (line.startsWith("deepen-not ")) {
      request.deepenNots.push(line.slice(11));
    } else if (line.startsWith("filter ")) {
      request.filter = line.slice(7);
    } else if (line === "sideband-all") {
      request.sidebandAll = true;
    }
  }

  return request;
}

/**
 * Build pack for V2 response.
 */
async function buildPackForV2(
  repository: RepositoryAccess,
  wants: ObjectId[],
  haves: ObjectId[],
  includeTag: boolean,
): Promise<Uint8Array> {
  const objects: Array<{ id: ObjectId; type: number; content: Uint8Array }> = [];
  const sentObjectIds = new Set<ObjectId>();

  for await (const obj of repository.walkObjects(wants, haves)) {
    objects.push({
      id: obj.id,
      type: obj.type,
      content: obj.content,
    });
    sentObjectIds.add(obj.id);
  }

  // Include-tag optimization
  if (includeTag) {
    for await (const ref of repository.listRefs()) {
      if (ref.peeledId && sentObjectIds.has(ref.peeledId) && !sentObjectIds.has(ref.objectId)) {
        const tagInfo = await repository.getObjectInfo(ref.objectId);
        if (tagInfo && tagInfo.type === 4) {
          const tagContent: Uint8Array[] = [];
          for await (const chunk of repository.loadObject(ref.objectId)) {
            tagContent.push(chunk);
          }
          const content = concatBytes(tagContent);
          objects.push({
            id: ref.objectId,
            type: tagInfo.type,
            content,
          });
          sentObjectIds.add(ref.objectId);
        }
      }
    }
  }

  // Build pack
  const chunks: Uint8Array[] = [];

  // Header
  const header = new Uint8Array(12);
  header.set(textEncoder.encode("PACK"), 0);
  header[4] = 0;
  header[5] = 0;
  header[6] = 0;
  header[7] = 2;
  const count = objects.length;
  header[8] = (count >> 24) & 0xff;
  header[9] = (count >> 16) & 0xff;
  header[10] = (count >> 8) & 0xff;
  header[11] = count & 0xff;
  chunks.push(header);

  // Objects
  for (const obj of objects) {
    const encoded = await encodePackObject(obj.type, obj.content, compressBlock);
    chunks.push(encoded);
  }

  const packWithoutChecksum = concatBytes(chunks);
  const checksum = await sha1(packWithoutChecksum);

  return concatBytes([packWithoutChecksum, checksum]);
}

/**
 * Encode a pack object.
 */
async function encodePackObject(
  type: number,
  content: Uint8Array,
  compressBlock: (data: Uint8Array, options?: { raw?: boolean }) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const headerBytes: number[] = [];
  let size = content.length;

  let firstByte = ((type & 0x07) << 4) | (size & 0x0f);
  size >>= 4;

  if (size > 0) {
    firstByte |= 0x80;
  }
  headerBytes.push(firstByte);

  while (size > 0) {
    let nextByte = size & 0x7f;
    size >>= 7;
    if (size > 0) {
      nextByte |= 0x80;
    }
    headerBytes.push(nextByte);
  }

  const compressed = await compressBlock(content, { raw: false });

  const result = new Uint8Array(headerBytes.length + compressed.length);
  result.set(headerBytes, 0);
  result.set(compressed, headerBytes.length);

  return result;
}

/**
 * Encode a sideband packet.
 */
function encodeSidebandPacket(channel: number, data: Uint8Array): Uint8Array {
  const length = data.length + 5;
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
