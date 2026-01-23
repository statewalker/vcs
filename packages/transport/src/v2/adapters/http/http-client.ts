/**
 * HTTP Smart Protocol client.
 *
 * Performs Git fetch over HTTP smart protocol:
 * 1. GET /info/refs?service=git-upload-pack - Get refs
 * 2. POST /git-upload-pack - Negotiate and receive pack
 */

import { encodeFlush, encodePacketLine } from "../../../protocol/pkt-line-codec.js";
import type { FetchResult } from "../../api/fetch-result.js";
import type { RepositoryFacade } from "../../api/repository-facade.js";
import type { RefStore } from "../../context/process-context.js";
import { ProtocolState } from "../../context/protocol-state.js";
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
