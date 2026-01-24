/**
 * HTTP Smart Protocol server handlers.
 *
 * Implements the Git Smart HTTP protocol:
 * - GET /info/refs?service=git-upload-pack - Ref advertisement
 * - POST /git-upload-pack - Pack negotiation and transfer
 */

import type { RepositoryFacade } from "../../api/repository-facade.js";
import { HandlerOutput } from "../../context/handler-output.js";
import type { ProcessConfiguration } from "../../context/process-config.js";
import type { ProcessContext, RefStore } from "../../context/process-context.js";
import { ProtocolState } from "../../context/protocol-state.js";
import { createTransportApi } from "../../factories/transport-api-factory.js";
import { serverFetchHandlers, serverFetchTransitions } from "../../fsm/fetch/server-fetch-fsm.js";
import { Fsm } from "../../fsm/fsm.js";
import { encodeFlush, encodePacketLine } from "../../protocol/pkt-line-codec.js";
import { createSimpleDuplex, readableStreamToAsyncIterable } from "./http-duplex.js";

/**
 * HTTP request information needed by handlers.
 */
export interface HttpRequest {
  /** HTTP method (GET, POST) */
  method: string;
  /** Request URL path */
  path: string;
  /** Query parameters */
  query: Record<string, string>;
  /** Request headers */
  headers: Record<string, string>;
  /** Request body as readable stream (for POST) */
  body?: ReadableStream<Uint8Array>;
}

/**
 * HTTP response to send back.
 */
export interface HttpResponse {
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Response body as Uint8Array */
  body: Uint8Array;
}

/**
 * Server options for HTTP handlers.
 */
export interface HttpServerOptions {
  /** Request policy for validating client wants */
  requestPolicy?: "ADVERTISED" | "REACHABLE_COMMIT" | "TIP" | "REACHABLE_COMMIT_TIP" | "ANY";
  /** Advertised capabilities */
  capabilities?: string[];
}

const textEncoder = new TextEncoder();

/**
 * Handles GET /info/refs?service=git-upload-pack
 *
 * Returns ref advertisement in smart HTTP format.
 *
 * @param refStore - Ref store for reading refs
 * @param options - Server options
 * @returns HTTP response
 */
export async function handleInfoRefs(
  refStore: RefStore,
  options: HttpServerOptions = {},
): Promise<HttpResponse> {
  // Get all refs
  const allRefs = await refStore.listAll();
  const refs = Array.from(allRefs);

  // Build ref advertisement
  const chunks: Uint8Array[] = [];

  // Service announcement line
  chunks.push(encodePacketLine("# service=git-upload-pack\n"));
  chunks.push(encodeFlush());

  // Default capabilities
  const capabilities = options.capabilities ?? [
    "multi_ack_detailed",
    "side-band-64k",
    "thin-pack",
    "no-progress",
    "include-tag",
    "ofs-delta",
    "shallow",
    "no-done",
  ];

  // First ref with capabilities
  if (refs.length > 0) {
    const [firstRefName, firstOid] = refs[0];
    const capsStr = capabilities.join(" ");
    chunks.push(encodePacketLine(`${firstOid} ${firstRefName}\0${capsStr}\n`));

    // Remaining refs
    for (let i = 1; i < refs.length; i++) {
      const [refName, oid] = refs[i];
      chunks.push(encodePacketLine(`${oid} ${refName}\n`));
    }
  } else {
    // Empty repo - send capabilities with zero OID
    const zeroOid = "0".repeat(40);
    const capsStr = capabilities.join(" ");
    chunks.push(encodePacketLine(`${zeroOid} capabilities^{}\0${capsStr}\n`));
  }

  chunks.push(encodeFlush());

  // Concatenate all chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  return {
    status: 200,
    headers: {
      "Content-Type": "application/x-git-upload-pack-advertisement",
      "Cache-Control": "no-cache",
    },
    body,
  };
}

/**
 * Handles POST /git-upload-pack
 *
 * Runs the fetch negotiation and sends pack data.
 *
 * @param request - HTTP request with body
 * @param repository - Repository facade for pack export
 * @param refStore - Ref store for reading refs
 * @param options - Server options
 * @returns HTTP response
 */
export async function handleUploadPack(
  request: HttpRequest,
  repository: RepositoryFacade,
  refStore: RefStore,
  options: HttpServerOptions = {},
): Promise<HttpResponse> {
  if (!request.body) {
    return {
      status: 400,
      headers: { "Content-Type": "text/plain" },
      body: textEncoder.encode("Missing request body"),
    };
  }

  const state = new ProtocolState();

  // Populate refs from refStore
  const allRefs = await refStore.listAll();
  for (const [refName, oid] of allRefs) {
    state.refs.set(refName, oid);
  }

  // Set up capabilities from info/refs response
  state.capabilities.add("multi_ack_detailed");
  state.capabilities.add("side-band-64k");
  state.capabilities.add("thin-pack");
  state.capabilities.add("no-progress");
  state.capabilities.add("include-tag");
  state.capabilities.add("ofs-delta");
  state.capabilities.add("shallow");
  state.capabilities.add("no-done");

  // Collect response data
  const responseChunks: Uint8Array[] = [];
  const writer = (data: Uint8Array) => responseChunks.push(data);

  // Create duplex from request body and response writer
  const input = readableStreamToAsyncIterable(request.body);
  const duplex = createSimpleDuplex(input, writer);
  const transport = createTransportApi(duplex, state);

  const config: ProcessConfiguration = {
    requestPolicy: options.requestPolicy ?? "ADVERTISED",
    maxEmptyBatches: 10,
  };

  const ctx: ProcessContext = {
    transport,
    repository,
    refStore,
    state,
    output: new HandlerOutput(),
    config,
  };

  // Run server FSM starting from READ_WANTS state
  // (ref advertisement was already sent in GET /info/refs)
  const fsm = new Fsm(serverFetchTransitions, serverFetchHandlers);
  fsm.setState("READ_WANTS");

  try {
    await fsm.run(ctx);

    if (ctx.output.error) {
      return {
        status: 500,
        headers: { "Content-Type": "text/plain" },
        body: textEncoder.encode(ctx.output.error),
      };
    }

    // Concatenate response chunks
    const totalLength = responseChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of responseChunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }

    return {
      status: 200,
      headers: {
        "Content-Type": "application/x-git-upload-pack-result",
        "Cache-Control": "no-cache",
      },
      body,
    };
  } catch (error) {
    return {
      status: 500,
      headers: { "Content-Type": "text/plain" },
      body: textEncoder.encode(error instanceof Error ? error.message : String(error)),
    };
  }
}

/**
 * Options for creating a Git HTTP server.
 */
export interface GitHttpServerOptions {
  /** Resolve repository for a given request */
  resolveRepository: (
    request: HttpRequest,
    repoPath?: string,
  ) => Promise<RepositoryFacade | null>;
  /** Optional request policy */
  requestPolicy?: "ADVERTISED" | "REACHABLE_COMMIT" | "TIP" | "REACHABLE_COMMIT_TIP" | "ANY";
}

/**
 * Git HTTP server interface.
 */
export interface GitHttpServer {
  /** Handle an HTTP request */
  handleRequest: (request: HttpRequest) => Promise<HttpResponse>;
  /** Stop the server */
  close: () => Promise<void>;
}

/**
 * Create a Git HTTP server that handles Git protocol requests.
 *
 * @param options - Server options
 * @returns A Git HTTP server
 *
 * @example
 * ```ts
 * const server = createGitHttpServer({
 *   async resolveRepository(request, repoPath) {
 *     return openRepository(repoPath);
 *   },
 * });
 *
 * // Handle incoming requests
 * const response = await server.handleRequest(request);
 * ```
 */
export function createGitHttpServer(options: GitHttpServerOptions): GitHttpServer {
  // TODO: Implement full Git HTTP server
  // This would route requests to handleInfoRefs and handleUploadPack

  void options; // Suppress unused parameter warning

  throw new Error(
    "createGitHttpServer not yet implemented. " +
      "Use handleInfoRefs and handleUploadPack directly.",
  );
}
