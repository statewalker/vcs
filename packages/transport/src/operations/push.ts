/**
 * High-level push operation.
 *
 * Provides a simplified interface for pushing to a remote repository
 * over HTTP/HTTPS.
 */

import type { Credentials } from "../api/credentials.js";
import { ZERO_OID } from "../protocol/constants.js";
import { createEmptyPack } from "../protocol/pack-utils.js";

/**
 * An object to push to the remote.
 */
export interface PushObject {
  /** Object ID (hex string) */
  id: string;
  /** Object type code (1=commit, 2=tree, 3=blob, 4=tag) */
  type: number;
  /** Object content */
  content: Uint8Array;
}

/**
 * Options for the push operation.
 */
export interface PushOptions {
  /** Remote URL */
  url: string;
  /** Refspecs to push (e.g., "refs/heads/main:refs/heads/main") */
  refspecs: string[];
  /** Authentication credentials */
  auth?: Credentials;
  /** Additional HTTP headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Force push (allow non-fast-forward) */
  force?: boolean;
  /** Atomic push (all-or-nothing) */
  atomic?: boolean;
  /** Progress message callback */
  onProgressMessage?: (message: string) => void;
  /** Get the object ID for a local ref */
  getLocalRef?: (refName: string) => Promise<string | undefined>;
  /** Get objects to push for given new/old object IDs */
  getObjectsToPush?: (newIds: string[], oldIds: string[]) => AsyncIterable<PushObject>;
}

/**
 * Result of updating a single ref.
 */
export interface RefUpdateResult {
  /** Whether the update succeeded */
  ok: boolean;
  /** Status message from server */
  message?: string;
}

/**
 * Result of a push operation.
 */
export interface PushResult {
  /** Whether the overall push succeeded */
  ok: boolean;
  /** Status of pack unpack on server (if failed) */
  unpackStatus?: string;
  /** Update results for each ref */
  updates: Map<string, RefUpdateResult>;
  /** Total bytes sent */
  bytesSent: number;
  /** Number of objects sent */
  objectCount: number;
}

/**
 * Push objects and refs to a remote repository.
 *
 * @param options - Push options
 * @returns Push result with update status
 *
 * @example
 * ```ts
 * const result = await push({
 *   url: "https://github.com/user/repo.git",
 *   refspecs: ["refs/heads/main:refs/heads/main"],
 *   auth: { token: "ghp_xxx" },
 *   getLocalRef: async (ref) => store.refs.get(ref)?.objectId,
 *   getObjectsToPush: async function* (newIds, oldIds) {
 *     // yield objects reachable from newIds but not oldIds
 *   },
 * });
 *
 * for (const [ref, status] of result.updates) {
 *   console.log(`${ref}: ${status.ok ? "OK" : status.message}`);
 * }
 * ```
 */
export async function push(options: PushOptions): Promise<PushResult> {
  // Normalize URL
  const baseUrl = options.url.endsWith("/") ? options.url.slice(0, -1) : options.url;

  // Build request headers
  const headers: Record<string, string> = {
    ...options.headers,
  };

  // Add authentication if provided
  if (options.auth) {
    const { username, password } = options.auth;
    const credentials = btoa(`${username}:${password}`);
    headers.Authorization = `Basic ${credentials}`;
  }

  // Setup timeout handling
  const controller = options.timeout ? new AbortController() : undefined;
  const timeoutId = options.timeout
    ? setTimeout(() => controller?.abort(), options.timeout)
    : undefined;

  const textEncoder = new TextEncoder();

  // Helper to encode pkt-line
  const encodePacketLine = (line: string): Uint8Array => {
    const withNewline = line.endsWith("\n") ? line : `${line}\n`;
    const payload = textEncoder.encode(withNewline);
    const length = payload.length + 4;
    const header = length.toString(16).padStart(4, "0");
    const result = new Uint8Array(length);
    result.set(textEncoder.encode(header), 0);
    result.set(payload, 4);
    return result;
  };

  const encodeFlush = (): Uint8Array => textEncoder.encode("0000");

  try {
    // Phase 1: GET /info/refs to get remote refs
    const infoRefsUrl = `${baseUrl}/info/refs?service=git-receive-pack`;
    const infoRefsResponse = await globalThis.fetch(infoRefsUrl, {
      method: "GET",
      headers: {
        ...headers,
        Accept: "application/x-git-receive-pack-advertisement",
      },
      signal: controller?.signal,
    });

    if (!infoRefsResponse.ok) {
      throw new Error(
        `Failed to get refs: ${infoRefsResponse.status} ${infoRefsResponse.statusText}`,
      );
    }

    if (!infoRefsResponse.body) {
      throw new Error("Empty response from /info/refs");
    }

    // Parse remote refs
    const infoRefsData = new Uint8Array(await infoRefsResponse.arrayBuffer());
    const remoteRefs = parseReceivePackAdvertisement(infoRefsData);

    // Phase 2: Parse refspecs and determine what to push
    const refUpdates: Array<{
      refName: string;
      oldOid: string;
      newOid: string;
    }> = [];

    for (const refspec of options.refspecs) {
      const [source, dest] = refspec.split(":");
      const destRef = dest || source;

      // Get local ref value
      const localOid = options.getLocalRef ? await options.getLocalRef(source) : undefined;

      if (!localOid) {
        throw new Error(`Local ref not found: ${source}`);
      }

      // Get remote ref value (if exists)
      const remoteOid = remoteRefs.get(destRef) || ZERO_OID;

      refUpdates.push({
        refName: destRef,
        oldOid: remoteOid,
        newOid: localOid,
      });
    }

    if (refUpdates.length === 0) {
      if (timeoutId) clearTimeout(timeoutId);
      return {
        ok: true,
        updates: new Map(),
        bytesSent: 0,
        objectCount: 0,
      };
    }

    // Phase 3: Build push request
    const requestChunks: Uint8Array[] = [];

    // Send ref update commands
    let firstUpdate = true;
    const newOids: string[] = [];
    const oldOids: string[] = [];

    for (const update of refUpdates) {
      if (update.newOid !== ZERO_OID) {
        newOids.push(update.newOid);
      }
      if (update.oldOid !== ZERO_OID) {
        oldOids.push(update.oldOid);
      }

      // Build capability string for first line
      const caps = firstUpdate
        ? ` report-status side-band-64k${options.atomic ? " atomic" : ""}${options.force ? "" : ""}`
        : "";

      const line = `${update.oldOid} ${update.newOid} ${update.refName}${caps}`;
      requestChunks.push(encodePacketLine(line));
      firstUpdate = false;
    }

    requestChunks.push(encodeFlush());

    // Generate pack data
    let objectCount = 0;
    if (newOids.length > 0 && options.getObjectsToPush) {
      const packWriter = new PackWriter();

      for await (const obj of options.getObjectsToPush(newOids, oldOids)) {
        packWriter.addObject(obj);
        objectCount++;
      }

      const packData = packWriter.finish();
      requestChunks.push(packData);
    } else {
      // Empty pack for delete-only operations
      requestChunks.push(createEmptyPack());
    }

    // Concatenate request body
    const requestBodyLength = requestChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const requestBody = new Uint8Array(requestBodyLength);
    let offset = 0;
    for (const chunk of requestChunks) {
      requestBody.set(chunk, offset);
      offset += chunk.length;
    }

    // Phase 4: POST /git-receive-pack
    const receivePackUrl = `${baseUrl}/git-receive-pack`;
    const receivePackResponse = await globalThis.fetch(receivePackUrl, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-git-receive-pack-request",
        Accept: "application/x-git-receive-pack-result",
      },
      body: requestBody,
      signal: controller?.signal,
    });

    if (!receivePackResponse.ok) {
      throw new Error(
        `Failed to receive-pack: ${receivePackResponse.status} ${receivePackResponse.statusText}`,
      );
    }

    if (!receivePackResponse.body) {
      throw new Error("Empty response from /git-receive-pack");
    }

    // Parse response
    const responseData = new Uint8Array(await receivePackResponse.arrayBuffer());
    const { updates, unpackStatus } = parseReportStatus(
      responseData,
      refUpdates,
      options.onProgressMessage,
    );

    if (timeoutId) clearTimeout(timeoutId);

    const allOk = Array.from(updates.values()).every((status) => status.ok);

    return {
      ok: allOk,
      unpackStatus,
      updates,
      bytesSent: requestBodyLength,
      objectCount,
    };
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new Error("Request timeout");
      }
      throw error;
    }
    throw new Error(String(error));
  }
}

/**
 * Parse receive-pack advertisement.
 */
function parseReceivePackAdvertisement(data: Uint8Array): Map<string, string> {
  const refs = new Map<string, string>();
  const textDecoder = new TextDecoder();
  const text = textDecoder.decode(data);
  const lines = text.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.trim() === "0000" || line.trim() === "0001") continue;
    if (line.includes("# service=")) continue;

    let content = line;
    if (/^[0-9a-f]{4}/.test(content)) {
      content = content.slice(4);
    }

    const nullIndex = content.indexOf("\0");
    const refPart = nullIndex >= 0 ? content.slice(0, nullIndex) : content;

    const spaceIndex = refPart.indexOf(" ");
    if (spaceIndex > 0) {
      const oid = refPart.slice(0, spaceIndex);
      const refName = refPart.slice(spaceIndex + 1).trim();

      if (!refName.endsWith("^{}") && !refName.startsWith("capabilities") && refName.length > 0) {
        refs.set(refName, oid);
      }
    }
  }

  return refs;
}

/**
 * Parse report-status response.
 */
function parseReportStatus(
  data: Uint8Array,
  refUpdates: Array<{ refName: string; oldOid: string; newOid: string }>,
  onProgress?: (message: string) => void,
): {
  updates: Map<string, RefUpdateResult>;
  unpackStatus?: string;
} {
  const updates = new Map<string, RefUpdateResult>();
  const textDecoder = new TextDecoder();
  let offset = 0;
  let unpackStatus: string | undefined;

  while (offset < data.length) {
    if (offset + 4 > data.length) break;

    const lengthHex = textDecoder.decode(data.slice(offset, offset + 4));
    if (lengthHex === "0000") {
      offset += 4;
      continue;
    }

    const length = parseInt(lengthHex, 16);
    if (Number.isNaN(length) || length < 4) break;

    if (offset + length > data.length) break;

    const payload = data.slice(offset + 4, offset + length);
    if (payload.length > 0) {
      const channel = payload[0];
      const content = textDecoder.decode(payload.slice(1)).trim();

      if (channel === 1) {
        // Status line
        if (content.startsWith("unpack ")) {
          unpackStatus = content;
        } else if (content.startsWith("ok ")) {
          const refName = content.slice(3);
          updates.set(refName, { ok: true });
        } else if (content.startsWith("ng ")) {
          const parts = content.slice(3).split(" ", 2);
          const refName = parts[0];
          const message = parts[1] || "unknown error";
          updates.set(refName, { ok: false, message });
        }
      } else if (channel === 2) {
        // Progress message
        if (onProgress) onProgress(content);
      } else if (channel === 3) {
        // Error message
        throw new Error(`Server error: ${content}`);
      }
    }

    offset += length;
  }

  // Fill in any missing updates
  for (const update of refUpdates) {
    if (!updates.has(update.refName)) {
      updates.set(update.refName, { ok: false, message: "No status received" });
    }
  }

  return { updates, unpackStatus };
}

/**
 * Simple pack writer for sending objects.
 */
class PackWriter {
  private objects: PushObject[] = [];

  addObject(obj: PushObject): void {
    this.objects.push(obj);
  }

  finish(): Uint8Array {
    if (this.objects.length === 0) {
      return createEmptyPack();
    }

    const textEncoder = new TextEncoder();
    const chunks: Uint8Array[] = [];

    // Pack header: "PACK" + version (2) + object count
    const header = new Uint8Array(12);
    header.set(textEncoder.encode("PACK"), 0);
    // Version 2 (big-endian)
    header[4] = 0;
    header[5] = 0;
    header[6] = 0;
    header[7] = 2;
    // Object count (big-endian)
    const count = this.objects.length;
    header[8] = (count >> 24) & 0xff;
    header[9] = (count >> 16) & 0xff;
    header[10] = (count >> 8) & 0xff;
    header[11] = count & 0xff;
    chunks.push(header);

    // Pack objects
    for (const obj of this.objects) {
      chunks.push(encodePackObject(obj));
    }

    // Concatenate all chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const packData = new Uint8Array(totalLength + 20); // +20 for SHA-1 checksum
    let offset = 0;
    for (const chunk of chunks) {
      packData.set(chunk, offset);
      offset += chunk.length;
    }

    // TODO: Compute actual SHA-1 checksum
    // For now, use placeholder
    const checksum = new Uint8Array(20);
    packData.set(checksum, offset);

    return packData;
  }
}

/**
 * Encode a single pack object.
 */
function encodePackObject(obj: PushObject): Uint8Array {
  // Simplified object encoding
  // In a real implementation, this would handle compression and delta encoding
  const header: number[] = [];
  let size = obj.content.length;
  const typeBits = obj.type & 0x7;

  // First byte: type and size bits
  let byte = (typeBits << 4) | (size & 0x0f);
  size >>= 4;

  while (size > 0) {
    byte |= 0x80; // MSB continuation bit
    header.push(byte);
    byte = size & 0x7f;
    size >>= 7;
  }
  header.push(byte);

  // Concatenate header and content
  const result = new Uint8Array(header.length + obj.content.length);
  result.set(new Uint8Array(header), 0);
  result.set(obj.content, header.length);

  return result;
}
