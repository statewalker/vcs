/**
 * Receive pack handler for git-receive-pack service.
 *
 * Protocol-independent implementation that handles push operations
 * by receiving pack files and updating refs.
 *
 * Based on JGit's ReceivePack.java
 */

import { decompressBlockPartial } from "@statewalker/vcs-utils";
import { bytesToHex } from "@statewalker/vcs-utils/hash/utils";
import {
  CAPABILITY_AGENT,
  CAPABILITY_ATOMIC,
  CAPABILITY_DELETE_REFS,
  CAPABILITY_OFS_DELTA,
  CAPABILITY_REPORT_STATUS,
  CAPABILITY_SIDE_BAND_64K,
  CAPABILITY_SYMREF,
  OBJECT_ID_STRING_LENGTH,
  SIDEBAND_DATA,
  ZERO_ID,
} from "../protocol/constants.js";
import {
  encodeFlush,
  encodePacket,
  packetDataToString,
  pktLineReader,
} from "../protocol/pkt-line-codec.js";
import type { Packet } from "../protocol/types.js";
import type {
  AdvertiseOptions,
  ObjectId,
  ReceivePackHandler,
  ReceivePackOptions,
  ReceivePackRequest,
  RepositoryAccess,
  ServerRefUpdate,
  ServerRefUpdateResult,
} from "./types.js";

const textEncoder = new TextEncoder();

/**
 * Default capabilities for receive-pack.
 */
const DEFAULT_CAPABILITIES = [
  CAPABILITY_REPORT_STATUS,
  CAPABILITY_SIDE_BAND_64K,
  CAPABILITY_DELETE_REFS,
  CAPABILITY_OFS_DELTA,
  CAPABILITY_ATOMIC,
];

/**
 * Agent string for capability advertisement.
 */
const AGENT_STRING = "statewalker-vcs/1.0";

/**
 * Create a receive pack handler.
 *
 * @param options - Handler options
 * @returns Receive pack handler
 */
export function createReceivePackHandler(options: ReceivePackOptions): ReceivePackHandler {
  const {
    repository,
    allowCreates = true,
    allowDeletes = true,
    allowNonFastForwards: _allowNonFastForwards = false,
    atomic = false,
    preReceive,
    postReceive,
  } = options;

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
      const request = await parseReceivePackRequest(input);

      if (request.updates.length === 0) {
        // No updates - send success status (nothing to unpack is still a success)
        yield encodePacket("unpack ok\n");
        yield encodeFlush();
        return;
      }

      // Check if client requested sideband
      const useSideband = request.capabilities.has(CAPABILITY_SIDE_BAND_64K);
      const useAtomicUpdate = atomic || request.capabilities.has(CAPABILITY_ATOMIC);

      // Validate ref updates
      const results: ServerRefUpdateResult[] = [];
      for (const update of request.updates) {
        const result = validateRefUpdate(update, { allowCreates, allowDeletes });
        results.push(result);
      }

      // If atomic and any failed, reject all
      if (useAtomicUpdate && results.some((r) => r.status === "rejected")) {
        for (const result of results) {
          if (result.status === "ok") {
            result.status = "rejected";
            result.message = "atomic push failed";
          }
        }
      }

      // Process pack data if present
      let unpackOk = true;
      let unpackMessage: string | undefined;

      if (request.packData.length > 0) {
        try {
          await processPackData(repository, request.packData);
        } catch (error) {
          unpackOk = false;
          unpackMessage = error instanceof Error ? error.message : "unpack failed";
          // Reject all updates if unpack failed
          for (const result of results) {
            result.status = "rejected";
            result.message = "unpack failed";
          }
        }
      }

      // Run pre-receive hook if provided
      if (unpackOk && preReceive) {
        const validUpdates = request.updates.filter((_, i) => results[i].status === "ok");
        if (validUpdates.length > 0) {
          const hookResults = await preReceive(validUpdates);
          // Merge hook results
          for (const hookResult of hookResults) {
            const idx = results.findIndex((r) => r.refName === hookResult.refName);
            if (idx !== -1 && hookResult.status === "rejected") {
              results[idx] = hookResult;
            }
          }
        }
      }

      // Apply ref updates
      if (unpackOk) {
        const appliedUpdates: ServerRefUpdate[] = [];
        for (let i = 0; i < request.updates.length; i++) {
          const update = request.updates[i];
          const result = results[i];

          if (result.status === "ok") {
            try {
              const oldId = update.oldId === ZERO_ID ? null : update.oldId;
              const newId = update.newId === ZERO_ID ? null : update.newId;
              const success = await repository.updateRef(update.refName, oldId, newId);
              if (!success) {
                result.status = "rejected";
                result.message = "failed to update ref";
              } else {
                appliedUpdates.push(update);
              }
            } catch (error) {
              result.status = "rejected";
              result.message = error instanceof Error ? error.message : "update failed";
            }
          }
        }

        // Run post-receive hook
        if (postReceive && appliedUpdates.length > 0) {
          await postReceive(appliedUpdates);
        }
      }

      // Build and send report-status response
      if (useSideband) {
        const statusData = buildReportStatus(unpackOk, results, unpackMessage);
        yield encodeSidebandPacket(SIDEBAND_DATA, statusData);
      } else {
        // Send status directly
        if (unpackOk) {
          yield encodePacket("unpack ok\n");
        } else {
          yield encodePacket(`unpack ${unpackMessage || "failed"}\n`);
        }
        for (const result of results) {
          if (result.status === "ok") {
            yield encodePacket(`ok ${result.refName}\n`);
          } else {
            yield encodePacket(`ng ${result.refName} ${result.message || "rejected"}\n`);
          }
        }
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
 * Parse receive-pack request from input stream.
 *
 * This function is stream-aware and does NOT wait for the input to close.
 * It reads pkt-lines until a flush packet, then optionally reads pack data.
 */
export async function parseReceivePackRequest(
  input: AsyncIterable<Uint8Array>,
): Promise<ReceivePackRequest> {
  const updates: ServerRefUpdate[] = [];
  const capabilities = new Set<string>();
  let isFirst = true;

  // Read pkt-lines directly from input (stream-aware)
  const packets = pktLineReader(input);

  for await (const packet of packets) {
    if (packet.type === "flush") {
      // Flush signals end of command portion
      break;
    }

    if (packet.type !== "data" || !packet.data) {
      continue;
    }

    const line = packetDataToString(packet);
    const update = parseRefUpdateCommand(line, isFirst ? capabilities : undefined);

    if (update) {
      updates.push(update);
    }

    isFirst = false;
  }

  // If no updates, no pack data expected
  if (updates.length === 0) {
    return { updates, capabilities, packData: new Uint8Array(0) };
  }

  // TODO: For updates with pack data, we need a more sophisticated approach
  // that can read raw bytes from a stream that's been partially consumed by pktLineReader.
  // For now, we return an empty pack which will cause the push to fail gracefully.
  // The original implementation collected all bytes first, which doesn't work with
  // multiplexed streams that don't close between operations.
  console.warn(
    "[receive-pack] Pack data reading in streaming mode not yet fully implemented. " +
      "Updates received but pack may be empty.",
  );

  // Read remaining data as pack (this may not work correctly due to pktLineReader buffering)
  const packChunks: Uint8Array[] = [];
  let timedOut = false;

  // Use a timeout to avoid blocking forever waiting for pack data
  const timeoutPromise = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), 100),
  );

  const iterator = input[Symbol.asyncIterator]();
  while (!timedOut) {
    const result = await Promise.race([iterator.next(), timeoutPromise]);
    if (result === "timeout") {
      timedOut = true;
      break;
    }
    if (result.done) break;
    packChunks.push(result.value);
  }

  return { updates, capabilities, packData: concatBytes(packChunks) };
}

/**
 * Parse a ref update command line.
 *
 * Format: "<old-id> <new-id> <ref-name>[\0<capabilities>]"
 */
function parseRefUpdateCommand(line: string, capabilities?: Set<string>): ServerRefUpdate | null {
  // Check for capabilities separator
  const nullIdx = line.indexOf("\0");
  let refPart = line;

  if (nullIdx >= 0) {
    refPart = line.slice(0, nullIdx);
    const capsPart = line.slice(nullIdx + 1);

    if (capabilities) {
      for (const cap of capsPart.split(" ")) {
        if (cap) {
          capabilities.add(cap);
        }
      }
    }
  }

  // Parse: <old-id> <new-id> <ref-name>
  const parts = refPart.split(" ");
  if (parts.length < 3) {
    return null;
  }

  const oldId = parts[0];
  const newId = parts[1];
  const refName = parts[2];

  // Validate object IDs
  if (oldId.length !== OBJECT_ID_STRING_LENGTH || newId.length !== OBJECT_ID_STRING_LENGTH) {
    return null;
  }

  // Validate ref name
  if (!refName || !isValidRefName(refName)) {
    return null;
  }

  return { oldId, newId, refName };
}

/**
 * Validate a ref name.
 * Based on JGit's RefDatabase.isValidRefName()
 */
function isValidRefName(name: string): boolean {
  if (!name || name.length === 0) {
    return false;
  }

  // Must not contain certain characters
  if (name.includes("..") || name.includes("^") || name.includes("~") || name.includes(":")) {
    return false;
  }

  // Must not start with / or end with /
  if (name.startsWith("/") || name.endsWith("/")) {
    return false;
  }

  // Must not contain //
  if (name.includes("//")) {
    return false;
  }

  return true;
}

/**
 * Validate a ref update.
 */
function validateRefUpdate(
  update: ServerRefUpdate,
  options: { allowCreates: boolean; allowDeletes: boolean },
): ServerRefUpdateResult {
  const isCreate = update.oldId === ZERO_ID;
  const isDelete = update.newId === ZERO_ID;

  if (isCreate && !options.allowCreates) {
    return { refName: update.refName, status: "rejected", message: "create not allowed" };
  }

  if (isDelete && !options.allowDeletes) {
    return { refName: update.refName, status: "rejected", message: "delete not allowed" };
  }

  return { refName: update.refName, status: "ok" };
}

/**
 * Process pack data and store objects.
 */
async function processPackData(repository: RepositoryAccess, packData: Uint8Array): Promise<void> {
  // Parse pack header
  if (packData.length < 12) {
    throw new Error("Pack data too short");
  }

  const signature = (packData[0] << 24) | (packData[1] << 16) | (packData[2] << 8) | packData[3];
  if (signature !== 0x5041434b) {
    // "PACK"
    throw new Error("Invalid pack signature");
  }

  const version = (packData[4] << 24) | (packData[5] << 16) | (packData[6] << 8) | packData[7];
  if (version !== 2 && version !== 3) {
    throw new Error(`Unsupported pack version: ${version}`);
  }

  const objectCount =
    (packData[8] << 24) | (packData[9] << 16) | (packData[10] << 8) | packData[11];

  // Parse and store each object
  const objectCache = new Map<number, { type: number; content: Uint8Array; id: string }>();
  const objectById = new Map<string, { type: number; content: Uint8Array }>();

  let offset = 12;
  for (let i = 0; i < objectCount; i++) {
    const entryStart = offset;

    // Read object header (type + size in variable-length encoding)
    let c = packData[offset++];
    const type = (c >> 4) & 0x07;
    let _size = c & 0x0f;
    let shift = 4;

    while ((c & 0x80) !== 0) {
      c = packData[offset++];
      _size |= (c & 0x7f) << shift;
      shift += 7;
    }

    let baseOffset: number | undefined;
    let baseId: string | undefined;

    // For delta types, read base reference
    if (type === 6) {
      // OFS_DELTA
      c = packData[offset++];
      baseOffset = c & 0x7f;
      while ((c & 0x80) !== 0) {
        baseOffset++;
        c = packData[offset++];
        baseOffset <<= 7;
        baseOffset += c & 0x7f;
      }
    } else if (type === 7) {
      // REF_DELTA
      baseId = bytesToHex(packData.subarray(offset, offset + 20));
      offset += 20;
    }

    // Decompress the object data
    const { data: decompressed, bytesRead } = await decompressPartial(packData.subarray(offset));
    offset += bytesRead;

    let resolved: { type: number; content: Uint8Array; id: string };

    if (type >= 1 && type <= 4) {
      // Base object types
      const content = new Uint8Array(decompressed);
      const id = await computeObjectId(type, content);
      resolved = { type, content, id };
    } else if (type === 6) {
      // OFS_DELTA
      const baseObjectOffset = entryStart - (baseOffset || 0);
      const base = objectCache.get(baseObjectOffset);
      if (!base) {
        throw new Error(`OFS_DELTA: base at offset ${baseObjectOffset} not found`);
      }
      const content = applyDelta(base.content, decompressed);
      const id = await computeObjectId(base.type, content);
      resolved = { type: base.type, content, id };
    } else if (type === 7) {
      // REF_DELTA
      const base = objectById.get(baseId || "");
      if (!base) {
        throw new Error(`REF_DELTA: base ${baseId} not found`);
      }
      const content = applyDelta(base.content, decompressed);
      const id = await computeObjectId(base.type, content);
      resolved = { type: base.type, content, id };
    } else {
      throw new Error(`Unknown object type: ${type}`);
    }

    objectCache.set(entryStart, resolved);
    objectById.set(resolved.id, { type: resolved.type, content: resolved.content });
  }

  // Store all resolved objects
  for (const [_id, obj] of objectById) {
    await repository.storeObject(obj.type as 1 | 2 | 3 | 4, obj.content);
  }
}

/**
 * Decompress data partially and return bytes read.
 * Uses the decompression utilities from @statewalker/vcs-utils.
 */
async function decompressPartial(
  data: Uint8Array,
): Promise<{ data: Uint8Array; bytesRead: number }> {
  const result = await decompressBlockPartial(data, { raw: false });
  return {
    data: result.data,
    bytesRead: result.bytesRead,
  };
}

/**
 * Compute object ID (SHA-1).
 */
async function computeObjectId(type: number, content: Uint8Array): Promise<string> {
  const typeStr = typeCodeToName(type);
  const header = textEncoder.encode(`${typeStr} ${content.length}\0`);
  const fullData = new Uint8Array(header.length + content.length);
  fullData.set(header, 0);
  fullData.set(content, header.length);

  const hash = await crypto.subtle.digest("SHA-1", fullData);
  return bytesToHex(new Uint8Array(hash));
}

/**
 * Convert type code to name.
 */
function typeCodeToName(type: number): string {
  switch (type) {
    case 1:
      return "commit";
    case 2:
      return "tree";
    case 3:
      return "blob";
    case 4:
      return "tag";
    default:
      throw new Error(`Unknown type code: ${type}`);
  }
}

/**
 * Apply delta to base content.
 */
function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let pos = 0;

  // Read base size (variable length)
  let _baseSize = 0;
  let shift = 0;
  while (pos < delta.length) {
    const b = delta[pos++];
    _baseSize |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }

  // Read result size
  let resultSize = 0;
  shift = 0;
  while (pos < delta.length) {
    const b = delta[pos++];
    resultSize |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }

  const result = new Uint8Array(resultSize);
  let resultPos = 0;

  while (pos < delta.length) {
    const cmd = delta[pos++];

    if (cmd & 0x80) {
      // Copy from base
      let copyOffset = 0;
      let copySize = 0;

      if (cmd & 0x01) copyOffset = delta[pos++];
      if (cmd & 0x02) copyOffset |= delta[pos++] << 8;
      if (cmd & 0x04) copyOffset |= delta[pos++] << 16;
      if (cmd & 0x08) copyOffset |= delta[pos++] << 24;

      if (cmd & 0x10) copySize = delta[pos++];
      if (cmd & 0x20) copySize |= delta[pos++] << 8;
      if (cmd & 0x40) copySize |= delta[pos++] << 16;

      if (copySize === 0) copySize = 0x10000;

      result.set(base.subarray(copyOffset, copyOffset + copySize), resultPos);
      resultPos += copySize;
    } else if (cmd > 0) {
      // Insert data
      result.set(delta.subarray(pos, pos + cmd), resultPos);
      pos += cmd;
      resultPos += cmd;
    } else {
      throw new Error("Invalid delta command: 0");
    }
  }

  return result;
}

/**
 * Build report-status response.
 */
function buildReportStatus(
  unpackOk: boolean,
  results: ServerRefUpdateResult[],
  unpackMessage?: string,
): Uint8Array {
  const chunks: Uint8Array[] = [];

  if (unpackOk) {
    chunks.push(encodePacket("unpack ok\n"));
  } else {
    chunks.push(encodePacket(`unpack ${unpackMessage || "failed"}\n`));
  }

  for (const result of results) {
    if (result.status === "ok") {
      chunks.push(encodePacket(`ok ${result.refName}\n`));
    } else {
      chunks.push(encodePacket(`ng ${result.refName} ${result.message || "rejected"}\n`));
    }
  }

  chunks.push(encodeFlush());

  return concatBytes(chunks);
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

/**
 * Process receive-pack request using a shared packets iterator.
 *
 * This function is used by the socket server to avoid creating multiple
 * pktLineReaders on the same stream, which would cause data loss.
 *
 * @param _handler - The receive pack handler (reserved for future configuration)
 * @param packets - Shared packets iterator from the server's pktLineReader
 * @param repository - Repository access for storing objects
 */
export async function* processReceivePackWithPackets(
  _handler: ReceivePackHandler,
  packets: AsyncIterator<Packet>,
  repository: RepositoryAccess,
): AsyncIterable<Uint8Array> {
  // Parse the request using the shared packets iterator
  const request = await parseReceivePackRequestFromPackets(packets);

  if (request.updates.length === 0) {
    // No updates - send success status (nothing to unpack is still a success)
    yield encodePacket("unpack ok\n");
    yield encodeFlush();
    return;
  }

  // Check if client requested sideband
  const useSideband = request.capabilities.has(CAPABILITY_SIDE_BAND_64K);
  const useAtomicUpdate = request.capabilities.has(CAPABILITY_ATOMIC);

  // Validate ref updates (using default options for socket server)
  const results: ServerRefUpdateResult[] = [];
  for (const update of request.updates) {
    const result = validateRefUpdate(update, { allowCreates: true, allowDeletes: true });
    results.push(result);
  }

  // If atomic and any failed, reject all
  if (useAtomicUpdate && results.some((r) => r.status === "rejected")) {
    for (const result of results) {
      if (result.status === "ok") {
        result.status = "rejected";
        result.message = "atomic push failed";
      }
    }
  }

  // Process pack data if present
  let unpackOk = true;
  let unpackMessage: string | undefined;

  if (request.packData.length > 0) {
    try {
      await processPackData(repository, request.packData);
    } catch (error) {
      unpackOk = false;
      unpackMessage = error instanceof Error ? error.message : "unpack failed";
      // Reject all updates if unpack failed
      for (const result of results) {
        result.status = "rejected";
        result.message = "unpack failed";
      }
    }
  }

  // Apply ref updates
  if (unpackOk) {
    for (let i = 0; i < request.updates.length; i++) {
      const update = request.updates[i];
      const result = results[i];

      if (result.status === "ok") {
        try {
          const oldId = update.oldId === ZERO_ID ? null : update.oldId;
          const newId = update.newId === ZERO_ID ? null : update.newId;
          const success = await repository.updateRef(update.refName, oldId, newId);
          if (!success) {
            result.status = "rejected";
            result.message = "failed to update ref";
          }
        } catch (error) {
          result.status = "rejected";
          result.message = error instanceof Error ? error.message : "update failed";
        }
      }
    }
  }

  // Build and send report-status response
  if (useSideband) {
    const statusData = buildReportStatus(unpackOk, results, unpackMessage);
    yield encodeSidebandPacket(SIDEBAND_DATA, statusData);
  } else {
    // Send status directly
    if (unpackOk) {
      yield encodePacket("unpack ok\n");
    } else {
      yield encodePacket(`unpack ${unpackMessage || "failed"}\n`);
    }
    for (const result of results) {
      if (result.status === "ok") {
        yield encodePacket(`ok ${result.refName}\n`);
      } else {
        yield encodePacket(`ng ${result.refName} ${result.message || "rejected"}\n`);
      }
    }
  }

  yield encodeFlush();
}

/**
 * Parse receive-pack request from a shared packets iterator.
 *
 * This version accepts a packets iterator instead of raw bytes, allowing the server
 * to share a single pktLineReader across multiple operations.
 */
async function parseReceivePackRequestFromPackets(
  packets: AsyncIterator<Packet>,
): Promise<ReceivePackRequest> {
  const updates: ServerRefUpdate[] = [];
  const capabilities = new Set<string>();
  let isFirst = true;

  // Read packets from the shared iterator until flush
  while (true) {
    const result = await packets.next();
    if (result.done) {
      break;
    }

    const packet = result.value;

    if (packet.type === "flush") {
      // Flush signals end of command portion
      break;
    }

    if (packet.type !== "data" || !packet.data) {
      continue;
    }

    const line = packetDataToString(packet);
    const update = parseRefUpdateCommand(line, isFirst ? capabilities : undefined);

    if (update) {
      updates.push(update);
    }

    isFirst = false;
  }

  // If no updates, no pack data expected
  if (updates.length === 0) {
    return { updates, capabilities, packData: new Uint8Array(0) };
  }

  // Read pack data from remaining packets
  // Pack data comes as data packets after the command flush
  const packChunks: Uint8Array[] = [];

  while (true) {
    const result = await packets.next();
    if (result.done) {
      break;
    }

    const packet = result.value;

    if (packet.type === "flush") {
      // End of pack data
      break;
    }

    if (packet.type === "data" && packet.data) {
      packChunks.push(packet.data);
    }
  }

  return { updates, capabilities, packData: concatBytes(packChunks) };
}
