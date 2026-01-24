/**
 * HTTP Smart Protocol client.
 *
 * Performs Git fetch and push over HTTP smart protocol:
 *
 * Fetch:
 * 1. GET /info/refs?service=git-upload-pack - Get refs
 * 2. POST /git-upload-pack - Negotiate and receive pack
 *
 * Push:
 * 1. GET /info/refs?service=git-receive-pack - Get refs
 * 2. POST /git-receive-pack - Send pack and update refs
 */

import type { FetchResult } from "../../api/fetch-result.js";
import type { RepositoryFacade } from "../../api/repository-facade.js";
import type { RefStore } from "../../context/process-context.js";
import { ProtocolState } from "../../context/protocol-state.js";
import type { PushResult, RefPushStatus } from "../../operations/push-over-duplex.js";
import { encodeFlush, encodePacketLine } from "../../protocol/pkt-line-codec.js";
import { collectChunks, readableStreamToAsyncIterable } from "./http-duplex.js";

/**
 * Options for HTTP fetch operation.
 */
export interface HttpFetchOptions {
  /** Local HEAD ref for negotiation */
  localHead?: string;
  /** Maximum haves to send during negotiation */
  maxHaves?: number;
  /** Shallow clone depth */
  depth?: number;
  /** Filter spec for partial clone */
  filter?: string;
  /** Refs to fetch (if not all) */
  refSpecs?: string[];
  /** Custom fetch function (for testing or different environments) */
  fetchFn?: typeof fetch;
}

const textDecoder = new TextDecoder();

/**
 * Performs a Git fetch over HTTP smart protocol.
 *
 * @param url - Repository URL (e.g., "https://github.com/user/repo.git")
 * @param repository - Repository facade for pack import
 * @param refStore - Ref store for reading/writing refs
 * @param options - Fetch options
 * @returns Fetch result
 *
 * @example
 * ```ts
 * const result = await httpFetch(
 *   "https://github.com/user/repo.git",
 *   repository,
 *   refStore,
 *   { localHead: "refs/heads/main" }
 * );
 *
 * if (result.success) {
 *   console.log("Updated refs:", result.updatedRefs);
 * }
 * ```
 */
export async function httpFetch(
  url: string,
  repository: RepositoryFacade,
  refStore: RefStore,
  options: HttpFetchOptions = {},
): Promise<FetchResult> {
  const fetchFn = options.fetchFn ?? fetch;

  // Normalize URL
  const baseUrl = url.endsWith("/") ? url.slice(0, -1) : url;

  try {
    // Phase 1: GET /info/refs to get ref advertisement
    const infoRefsUrl = `${baseUrl}/info/refs?service=git-upload-pack`;
    const infoRefsResponse = await fetchFn(infoRefsUrl, {
      method: "GET",
      headers: {
        Accept: "application/x-git-upload-pack-advertisement",
      },
    });

    if (!infoRefsResponse.ok) {
      return {
        success: false,
        error: `Failed to get refs: ${infoRefsResponse.status} ${infoRefsResponse.statusText}`,
      };
    }

    if (!infoRefsResponse.body) {
      return {
        success: false,
        error: "Empty response from /info/refs",
      };
    }

    // Parse ref advertisement
    const state = new ProtocolState();
    const infoRefsData = await collectChunks(readableStreamToAsyncIterable(infoRefsResponse.body));

    parseRefAdvertisement(infoRefsData, state);

    // Check if there's anything to fetch
    if (state.refs.size === 0) {
      return {
        success: true,
        updatedRefs: new Map(),
        objectsImported: 0,
      };
    }

    // Phase 2: POST /git-upload-pack to negotiate and receive pack
    const uploadPackUrl = `${baseUrl}/git-upload-pack`;

    // Build request body: wants + haves + done
    const requestChunks: Uint8Array[] = [];

    // Determine what we want (all refs by default)
    let firstWant = true;
    for (const [_refName, oid] of state.refs) {
      state.wants.add(oid);

      // Add capabilities to first want line
      const caps = firstWant
        ? " multi_ack_detailed side-band-64k thin-pack no-progress include-tag ofs-delta no-done"
        : "";
      requestChunks.push(encodePacketLine(`want ${oid}${caps}`));
      firstWant = false;
    }
    requestChunks.push(encodeFlush());

    // Send haves for objects we already have
    const localRefs = await refStore.listAll();
    for (const [, localOid] of localRefs) {
      const hasObject = await repository.has(localOid);
      if (hasObject) {
        state.haves.add(localOid);
        requestChunks.push(encodePacketLine(`have ${localOid}`));
      }
    }
    requestChunks.push(encodeFlush());

    // Send done
    requestChunks.push(encodePacketLine("done"));

    // Concatenate request body
    const requestBodyLength = requestChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const requestBody = new Uint8Array(requestBodyLength);
    let offset = 0;
    for (const chunk of requestChunks) {
      requestBody.set(chunk, offset);
      offset += chunk.length;
    }

    // Send POST request
    const uploadPackResponse = await fetchFn(uploadPackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-git-upload-pack-request",
        Accept: "application/x-git-upload-pack-result",
      },
      body: requestBody,
    });

    if (!uploadPackResponse.ok) {
      return {
        success: false,
        error: `Failed to upload-pack: ${uploadPackResponse.status} ${uploadPackResponse.statusText}`,
      };
    }

    if (!uploadPackResponse.body) {
      return {
        success: false,
        error: "Empty response from /git-upload-pack",
      };
    }

    // Process response - skip ACK/NAK, import pack
    const responseData = await collectChunks(
      readableStreamToAsyncIterable(uploadPackResponse.body),
    );

    // Find where pack data starts (after flush or NAK)
    const packStartIndex = findPackDataStart(responseData);

    if (packStartIndex < 0) {
      // No pack data - might be up-to-date
      return {
        success: true,
        updatedRefs: new Map(),
        objectsImported: 0,
      };
    }

    // Import pack data
    const packData = responseData.slice(packStartIndex);
    const packStream = (async function* () {
      yield packData;
    })();

    const importResult = await repository.importPack(packStream);

    // Update local refs
    const updatedRefs = new Map<string, string>();
    for (const [refName, oid] of state.refs) {
      await refStore.update(refName, oid);
      updatedRefs.set(refName, oid);
    }

    return {
      success: true,
      updatedRefs,
      objectsImported: importResult.objectsImported,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Parses ref advertisement from /info/refs response.
 */
function parseRefAdvertisement(data: Uint8Array, state: ProtocolState): void {
  // Convert to text for easier parsing
  const text = textDecoder.decode(data);
  const lines = text.split("\n");

  let _parsingRefs = false;

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Skip pkt-line headers
    if (line.startsWith("0000") || line.startsWith("0001")) {
      _parsingRefs = true;
      continue;
    }

    // Skip service announcement
    if (line.includes("# service=")) {
      continue;
    }

    // Extract the actual content (remove pkt-line length prefix if present)
    let content = line;
    if (/^[0-9a-f]{4}/.test(content)) {
      content = content.slice(4);
    }

    // Parse ref line: "OID refname\0capabilities" or "OID refname"
    const nullIndex = content.indexOf("\0");
    const refPart = nullIndex >= 0 ? content.slice(0, nullIndex) : content;
    const capsPart = nullIndex >= 0 ? content.slice(nullIndex + 1) : "";

    // Parse capabilities from first ref
    if (capsPart) {
      const caps = capsPart.trim().split(" ");
      for (const cap of caps) {
        if (cap) state.capabilities.add(cap);
      }
    }

    // Parse ref
    const spaceIndex = refPart.indexOf(" ");
    if (spaceIndex > 0) {
      const oid = refPart.slice(0, spaceIndex);
      const refName = refPart.slice(spaceIndex + 1).trim();

      // Skip capabilities^{} pseudo-ref
      if (!refName.endsWith("^{}") && !refName.startsWith("capabilities")) {
        state.refs.set(refName, oid);
      }
    }
  }
}

/**
 * Finds where pack data starts in the response.
 *
 * Pack data starts after "NAK" or after ACK negotiation.
 * It's identified by the PACK signature (0x50, 0x41, 0x43, 0x4b).
 */
function findPackDataStart(data: Uint8Array): number {
  // Look for PACK signature
  const packSignature = [0x50, 0x41, 0x43, 0x4b]; // "PACK"

  for (let i = 0; i <= data.length - 4; i++) {
    if (
      data[i] === packSignature[0] &&
      data[i + 1] === packSignature[1] &&
      data[i + 2] === packSignature[2] &&
      data[i + 3] === packSignature[3]
    ) {
      return i;
    }
  }

  return -1;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Push Client
// ─────────────────────────────────────────────────────────────────────────────

const _textEncoder = new TextEncoder();

/**
 * Options for HTTP push operation.
 */
export interface HttpPushOptions {
  /** Refs to push (format: "local:remote" or "refname") */
  refspecs: string[];
  /** Use atomic push (all refs succeed or all fail) */
  atomic?: boolean;
  /** Push options to send to server */
  pushOptions?: string[];
  /** Credentials for authentication */
  credentials?: { username: string; password: string };
  /** Additional headers to send */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Progress callback */
  onProgress?: (message: string) => void;
  /** Custom fetch function (for testing or different environments) */
  fetchFn?: typeof fetch;
}

/**
 * Performs a Git push over HTTP smart protocol.
 *
 * @param url - Repository URL (e.g., "https://github.com/user/repo.git")
 * @param repository - Repository facade for pack export
 * @param refStore - Ref store for reading local refs
 * @param options - Push options
 * @returns Push result
 *
 * @example
 * ```ts
 * const result = await httpPush(
 *   "https://github.com/user/repo.git",
 *   repository,
 *   refStore,
 *   {
 *     refspecs: ["refs/heads/main:refs/heads/main"],
 *     atomic: true,
 *   }
 * );
 *
 * if (result.success) {
 *   console.log("Push successful");
 * }
 * ```
 */
export async function httpPush(
  url: string,
  repository: RepositoryFacade,
  refStore: RefStore,
  options: HttpPushOptions,
): Promise<PushResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const { refspecs, atomic = false, pushOptions = [], credentials, headers = {} } = options;

  // Normalize URL
  const baseUrl = url.endsWith("/") ? url.slice(0, -1) : url;

  // Build authorization header if credentials provided
  const authHeaders: Record<string, string> = {};
  if (credentials) {
    const authString = `${credentials.username}:${credentials.password}`;
    const base64Auth = btoa(authString);
    authHeaders.Authorization = `Basic ${base64Auth}`;
  }

  const combinedHeaders = { ...headers, ...authHeaders };

  try {
    // Phase 1: GET /info/refs?service=git-receive-pack
    options.onProgress?.("Fetching remote refs...");

    const infoRefsUrl = `${baseUrl}/info/refs?service=git-receive-pack`;
    const infoRefsResponse = await fetchFn(infoRefsUrl, {
      method: "GET",
      headers: {
        ...combinedHeaders,
        Accept: "application/x-git-receive-pack-advertisement",
      },
    });

    if (!infoRefsResponse.ok) {
      return {
        success: false,
        error: `Failed to get refs: ${infoRefsResponse.status} ${infoRefsResponse.statusText}`,
      };
    }

    if (!infoRefsResponse.body) {
      return {
        success: false,
        error: "Empty response from /info/refs",
      };
    }

    // Parse ref advertisement
    const state = new ProtocolState();
    const infoRefsData = await collectChunks(readableStreamToAsyncIterable(infoRefsResponse.body));
    parseReceivePackAdvertisement(infoRefsData, state);

    // Phase 2: Parse refspecs and determine what to push
    const refUpdates = await resolveRefspecs(refspecs, refStore, state.refs);

    if (refUpdates.length === 0) {
      return {
        success: true,
        refStatus: new Map(),
      };
    }

    // Phase 3: Build and send receive-pack request
    options.onProgress?.("Sending pack data...");

    const receivePackUrl = `${baseUrl}/git-receive-pack`;

    // Build request body
    const requestChunks: Uint8Array[] = [];

    // Send ref update commands
    let firstUpdate = true;
    const wantedOids = new Set<string>();

    for (const update of refUpdates) {
      // Collect OIDs we need to send
      if (update.newOid !== "0".repeat(40)) {
        wantedOids.add(update.newOid);
      }

      // Build capability string for first line
      const caps = firstUpdate
        ? ` report-status side-band-64k${atomic ? " atomic" : ""}${pushOptions.length > 0 ? " push-options" : ""}`
        : "";

      const line = `${update.oldOid} ${update.newOid} ${update.refName}${caps}`;
      requestChunks.push(encodePacketLine(line));
      firstUpdate = false;
    }

    requestChunks.push(encodeFlush());

    // Send push options if supported
    if (pushOptions.length > 0 && state.capabilities.has("push-options")) {
      for (const option of pushOptions) {
        requestChunks.push(encodePacketLine(option));
      }
      requestChunks.push(encodeFlush());
    }

    // Generate and append pack data if we have objects to send
    if (wantedOids.size > 0) {
      // Determine what objects the server already has
      const excludeOids = new Set<string>();
      for (const oid of state.refs.values()) {
        excludeOids.add(oid);
      }

      // Export pack with objects the server doesn't have
      for await (const chunk of repository.exportPack(wantedOids, excludeOids)) {
        requestChunks.push(chunk);
      }
    } else {
      // Send empty pack for delete-only operations
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

    // Send POST request
    const receivePackResponse = await fetchFn(receivePackUrl, {
      method: "POST",
      headers: {
        ...combinedHeaders,
        "Content-Type": "application/x-git-receive-pack-request",
        Accept: "application/x-git-receive-pack-result",
      },
      body: requestBody,
    });

    if (!receivePackResponse.ok) {
      return {
        success: false,
        error: `Failed to receive-pack: ${receivePackResponse.status} ${receivePackResponse.statusText}`,
      };
    }

    if (!receivePackResponse.body) {
      return {
        success: false,
        error: "Empty response from /git-receive-pack",
      };
    }

    // Parse response to get ref statuses
    const responseData = await collectChunks(
      readableStreamToAsyncIterable(receivePackResponse.body),
    );

    const refStatus = parseReportStatus(responseData, refUpdates);

    // Check if all refs succeeded
    const allSuccess = Array.from(refStatus.values()).every((status) => status.success);

    options.onProgress?.(allSuccess ? "Push complete" : "Push completed with errors");

    return {
      success: allSuccess,
      refStatus,
      error: allSuccess ? undefined : "Some refs failed to update",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Parses receive-pack ref advertisement.
 */
function parseReceivePackAdvertisement(data: Uint8Array, state: ProtocolState): void {
  // Similar to parseRefAdvertisement but for receive-pack
  const text = textDecoder.decode(data);
  const lines = text.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith("0000") || line.startsWith("0001")) continue;
    if (line.includes("# service=")) continue;

    let content = line;
    if (/^[0-9a-f]{4}/.test(content)) {
      content = content.slice(4);
    }

    const nullIndex = content.indexOf("\0");
    const refPart = nullIndex >= 0 ? content.slice(0, nullIndex) : content;
    const capsPart = nullIndex >= 0 ? content.slice(nullIndex + 1) : "";

    if (capsPart) {
      const caps = capsPart.trim().split(" ");
      for (const cap of caps) {
        if (cap) state.capabilities.add(cap);
      }
    }

    const spaceIndex = refPart.indexOf(" ");
    if (spaceIndex > 0) {
      const oid = refPart.slice(0, spaceIndex);
      const refName = refPart.slice(spaceIndex + 1).trim();
      if (!refName.endsWith("^{}") && !refName.startsWith("capabilities")) {
        state.refs.set(refName, oid);
      }
    }
  }
}

/**
 * Ref update command.
 */
interface RefUpdate {
  refName: string;
  oldOid: string;
  newOid: string;
}

/**
 * Resolves refspecs to ref update commands.
 */
async function resolveRefspecs(
  refspecs: string[],
  refStore: RefStore,
  remoteRefs: Map<string, string>,
): Promise<RefUpdate[]> {
  const updates: RefUpdate[] = [];
  const zeroOid = "0".repeat(40);

  for (const refspec of refspecs) {
    let localRef: string;
    let remoteRef: string;

    // Parse refspec (local:remote or just ref for same name)
    if (refspec.includes(":")) {
      const parts = refspec.split(":");
      localRef = parts[0];
      remoteRef = parts[1];
    } else {
      localRef = refspec;
      remoteRef = refspec;
    }

    // Handle deletion (empty local ref)
    if (localRef === "") {
      updates.push({
        refName: remoteRef,
        oldOid: remoteRefs.get(remoteRef) ?? zeroOid,
        newOid: zeroOid,
      });
      continue;
    }

    // Get local ref value
    const localOid = await refStore.get(localRef);
    if (!localOid) {
      // Skip refs we don't have locally
      continue;
    }

    updates.push({
      refName: remoteRef,
      oldOid: remoteRefs.get(remoteRef) ?? zeroOid,
      newOid: localOid,
    });
  }

  return updates;
}

/**
 * Creates an empty pack file.
 */
function createEmptyPack(): Uint8Array {
  // PACK header + version 2 + 0 objects + checksum
  const pack = new Uint8Array(32);

  // "PACK"
  pack[0] = 0x50;
  pack[1] = 0x41;
  pack[2] = 0x43;
  pack[3] = 0x4b;

  // Version 2
  pack[7] = 0x02;

  // 0 objects (already zeros)

  // Checksum (zeros for simplicity - would need real SHA-1 in production)

  return pack;
}

/**
 * Parses report-status from receive-pack response.
 */
function parseReportStatus(data: Uint8Array, refUpdates: RefUpdate[]): Map<string, RefPushStatus> {
  const status = new Map<string, RefPushStatus>();
  const text = textDecoder.decode(data);

  // Initialize all refs as successful (optimistic)
  for (const update of refUpdates) {
    status.set(update.refName, { success: true });
  }

  // Look for "unpack" status and "ng" (not good) lines
  const lines = text.split("\n");

  for (const line of lines) {
    let content = line;

    // Remove sideband prefix if present
    if (content.length > 0 && (content[0] === "\x01" || content[0] === "\x02")) {
      content = content.slice(1);
    }

    // Remove pkt-line length prefix if present
    if (/^[0-9a-f]{4}/.test(content)) {
      content = content.slice(4);
    }

    content = content.trim();

    // Check for unpack failure
    if (content.startsWith("unpack ") && !content.includes("unpack ok")) {
      // Unpack failed - mark all refs as failed
      for (const update of refUpdates) {
        status.set(update.refName, {
          success: false,
          error: content,
        });
      }
      continue;
    }

    // Check for individual ref failures: "ng <ref> <reason>"
    if (content.startsWith("ng ")) {
      const parts = content.slice(3).split(" ");
      const refName = parts[0];
      const reason = parts.slice(1).join(" ");

      status.set(refName, {
        success: false,
        error: reason || "Unknown error",
      });
    }
  }

  return status;
}
