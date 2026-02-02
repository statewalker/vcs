/**
 * High-level fetch operation.
 *
 * Provides a simplified interface for fetching from a remote repository
 * over HTTP/HTTPS.
 */

import type { Credentials, ProgressInfo } from "../api/credentials.js";

/**
 * Options for the fetch operation.
 */
export interface FetchOptions {
  /** Remote URL */
  url: string;
  /** Refspecs to fetch */
  refspecs?: string[];
  /** Authentication credentials */
  auth?: Credentials;
  /** Additional HTTP headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Shallow clone depth */
  depth?: number;
  /** Progress callback */
  onProgress?: (info: ProgressInfo) => void;
  /** Progress message callback */
  onProgressMessage?: (message: string) => void;
  /** Check if local repository has an object */
  localHas?: (objectId: Uint8Array) => Promise<boolean>;
  /** Get local commit objects for negotiation */
  localCommits?: () => AsyncIterable<Uint8Array>;
}

/**
 * Result of a HTTP fetch operation.
 */
export interface HttpFetchResult {
  /** Map of ref names to object IDs */
  refs: Map<string, Uint8Array>;
  /** Pack data received */
  packData: Uint8Array;
  /** Default branch name */
  defaultBranch?: string;
  /** Total bytes received */
  bytesReceived: number;
  /** Whether the remote repository is empty */
  isEmpty: boolean;
}

/**
 * Fetch objects and refs from a remote repository.
 *
 * @param options - Fetch options
 * @returns Fetch result with refs and pack data
 *
 * @example
 * ```ts
 * const result = await fetch({
 *   url: "https://github.com/user/repo.git",
 *   refspecs: ["+refs/heads/*:refs/remotes/origin/*"],
 * });
 *
 * console.log("Default branch:", result.defaultBranch);
 * console.log("Bytes received:", result.bytesReceived);
 * ```
 */
export async function fetch(options: FetchOptions): Promise<HttpFetchResult> {
  // Normalize URL
  const baseUrl = options.url.endsWith("/")
    ? options.url.slice(0, -1)
    : options.url;

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

  try {
    // Phase 1: GET /info/refs to get ref advertisement
    const infoRefsUrl = `${baseUrl}/info/refs?service=git-upload-pack`;
    const infoRefsResponse = await globalThis.fetch(infoRefsUrl, {
      method: "GET",
      headers: {
        ...headers,
        Accept: "application/x-git-upload-pack-advertisement",
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

    // Parse ref advertisement
    const infoRefsData = new Uint8Array(await infoRefsResponse.arrayBuffer());
    const { refs, defaultBranch, isEmpty } =
      parseRefAdvertisementForFetch(infoRefsData);

    // If repository is empty, return early
    if (isEmpty || refs.size === 0) {
      if (timeoutId) clearTimeout(timeoutId);
      return {
        refs: new Map(),
        packData: new Uint8Array(0),
        defaultBranch,
        bytesReceived: 0,
        isEmpty: true,
      };
    }

    // Phase 2: Build want/have negotiation request
    const requestChunks: Uint8Array[] = [];
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

    // Send wants (all refs by default, or filtered by refspecs)
    let firstWant = true;
    for (const [_refName, oid] of refs) {
      const oidHex = Array.from(oid)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Add capabilities to first want line
      const caps = firstWant
        ? " multi_ack_detailed side-band-64k thin-pack no-progress include-tag ofs-delta no-done"
        : "";
      requestChunks.push(encodePacketLine(`want ${oidHex}${caps}`));
      firstWant = false;
    }
    requestChunks.push(encodeFlush());

    // Send haves if localHas is provided
    if (options.localHas && options.localCommits) {
      for await (const oid of options.localCommits()) {
        const hasObject = await options.localHas(oid);
        if (hasObject) {
          const oidHex = Array.from(oid)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          requestChunks.push(encodePacketLine(`have ${oidHex}`));
        }
      }
    }
    requestChunks.push(encodeFlush());

    // Send done
    requestChunks.push(encodePacketLine("done"));

    // Concatenate request body
    const requestBodyLength = requestChunks.reduce(
      (sum, chunk) => sum + chunk.length,
      0,
    );
    const requestBody = new Uint8Array(requestBodyLength);
    let offset = 0;
    for (const chunk of requestChunks) {
      requestBody.set(chunk, offset);
      offset += chunk.length;
    }

    // Phase 3: POST /git-upload-pack to receive pack
    const uploadPackUrl = `${baseUrl}/git-upload-pack`;
    const uploadPackResponse = await globalThis.fetch(uploadPackUrl, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-git-upload-pack-request",
        Accept: "application/x-git-upload-pack-result",
      },
      body: requestBody,
      signal: controller?.signal,
    });

    if (!uploadPackResponse.ok) {
      throw new Error(
        `Failed to upload-pack: ${uploadPackResponse.status} ${uploadPackResponse.statusText}`,
      );
    }

    if (!uploadPackResponse.body) {
      throw new Error("Empty response from /git-upload-pack");
    }

    // Read response data
    const responseData = new Uint8Array(await uploadPackResponse.arrayBuffer());

    // Decode sideband response to extract pack data
    const packData = decodeSidebandResponse(responseData, options.onProgressMessage);

    if (timeoutId) clearTimeout(timeoutId);

    return {
      refs,
      packData,
      defaultBranch,
      bytesReceived: responseData.length,
      isEmpty: false,
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
 * Parse ref advertisement for fetch operation.
 */
function parseRefAdvertisementForFetch(data: Uint8Array): {
  refs: Map<string, Uint8Array>;
  defaultBranch?: string;
  isEmpty: boolean;
} {
  const refs = new Map<string, Uint8Array>();
  const textDecoder = new TextDecoder();
  const text = textDecoder.decode(data);
  const lines = text.split("\n");

  let defaultBranch: string | undefined;
  let isEmpty = false;

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Skip flush/delim packets
    if (line.trim() === "0000" || line.trim() === "0001") {
      continue;
    }

    // Skip service announcement
    if (line.includes("# service=")) {
      continue;
    }

    // Extract content (remove pkt-line length prefix)
    let content = line;
    if (/^[0-9a-f]{4}/.test(content)) {
      content = content.slice(4);
    }

    // Parse capabilities from first line
    const nullIndex = content.indexOf("\0");
    const refPart = nullIndex >= 0 ? content.slice(0, nullIndex) : content;
    const capsPart = nullIndex >= 0 ? content.slice(nullIndex + 1) : "";

    // Check for symref capability to detect default branch
    if (capsPart) {
      const symrefMatch = capsPart.match(/symref=HEAD:([^\s]+)/);
      if (symrefMatch) {
        defaultBranch = symrefMatch[1];
      }

      // Check for empty repository
      if (content.includes("capabilities^{}")) {
        isEmpty = true;
      }
    }

    // Parse ref: "OID refname"
    const spaceIndex = refPart.indexOf(" ");
    if (spaceIndex > 0) {
      const oidHex = refPart.slice(0, spaceIndex);
      const refName = refPart.slice(spaceIndex + 1).trim();

      // Skip peeled refs and capabilities
      if (
        !refName.endsWith("^{}") &&
        !refName.startsWith("capabilities") &&
        refName.length > 0
      ) {
        // Convert hex string to Uint8Array
        const oid = new Uint8Array(20);
        for (let i = 0; i < 20; i++) {
          oid[i] = parseInt(oidHex.slice(i * 2, i * 2 + 2), 16);
        }
        refs.set(refName, oid);
      }
    }
  }

  return { refs, defaultBranch, isEmpty };
}

/**
 * Decode sideband response to extract pack data.
 *
 * Git uses sideband multiplexing:
 * - Channel 1: Pack data
 * - Channel 2: Progress messages
 * - Channel 3: Error messages
 */
function decodeSidebandResponse(
  data: Uint8Array,
  onProgress?: (message: string) => void,
): Uint8Array {
  const packChunks: Uint8Array[] = [];
  const textDecoder = new TextDecoder();
  let offset = 0;

  while (offset < data.length) {
    // Read pkt-line length
    if (offset + 4 > data.length) break;

    const lengthHex = textDecoder.decode(data.slice(offset, offset + 4));
    if (lengthHex === "0000") {
      // Flush packet - end of section
      offset += 4;
      continue;
    }

    const length = parseInt(lengthHex, 16);
    if (Number.isNaN(length) || length < 4) {
      throw new Error(`Invalid packet length: ${lengthHex}`);
    }

    if (offset + length > data.length) {
      throw new Error("Incomplete packet");
    }

    // Read packet payload (excluding length prefix)
    const payload = data.slice(offset + 4, offset + length);

    if (payload.length > 0) {
      const channel = payload[0];
      const content = payload.slice(1);

      if (channel === 1) {
        // Pack data
        packChunks.push(content);
      } else if (channel === 2) {
        // Progress message
        if (onProgress) {
          const message = textDecoder.decode(content).trim();
          onProgress(message);
        }
      } else if (channel === 3) {
        // Error message
        const errorMessage = textDecoder.decode(content).trim();
        throw new Error(`Server error: ${errorMessage}`);
      }
    }

    offset += length;
  }

  // Concatenate all pack data chunks
  const totalLength = packChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const packData = new Uint8Array(totalLength);
  let packOffset = 0;
  for (const chunk of packChunks) {
    packData.set(chunk, packOffset);
    packOffset += chunk.length;
  }

  return packData;
}
