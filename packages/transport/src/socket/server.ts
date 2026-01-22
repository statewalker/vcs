/**
 * Git socket server implementation.
 *
 * Handles Git protocol connections over MessagePort.
 * Suitable for P2P synchronization where both peers communicate
 * over a MessagePort-based channel.
 */

import { createReceivePackHandler } from "../handlers/receive-pack-handler.js";
import type { RepositoryAccess } from "../handlers/types.js";
import { createUploadPackHandler } from "../handlers/upload-pack-handler.js";
import { encodePacket, pktLineReader } from "../protocol/pkt-line-codec.js";
import {
  createMessagePortCloser,
  createMessagePortReader,
  createMessagePortWriter,
} from "./messageport-adapters.js";

/**
 * Wrap an async iterator to prevent early termination from closing it.
 *
 * When you `break` out of a `for await...of` loop, it calls `return()` on the iterator,
 * which cascades to close underlying iterators. This wrapper intercepts `return()`
 * to prevent closing the underlying iterator, allowing it to be reused for subsequent reads.
 */
function nonClosingIterable<T>(source: AsyncIterable<T>): AsyncIterable<T> {
  const iterator = source[Symbol.asyncIterator]();
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => iterator.next(),
        // Don't propagate return() to the underlying iterator
        return: async (value?: unknown) => {
          return { done: true as const, value: value as T };
        },
        throw: async (error?: unknown) => {
          if (iterator.throw) {
            return iterator.throw(error);
          }
          throw error;
        },
      };
    },
  };
}

/**
 * Options for Git socket server operations.
 */
export interface GitSocketServerOptions {
  /**
   * Resolve repository from path.
   * Returns null if repository not found.
   */
  resolveRepository: (path: string) => Promise<RepositoryAccess | null>;

  /**
   * Optional authentication callback.
   * Returns true if access is allowed.
   */
  authenticate?: (host: string, path: string) => Promise<boolean>;

  /**
   * Optional logger for debugging.
   */
  logger?: {
    debug?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
}

/**
 * Parsed initial Git protocol request.
 */
interface GitProtocolRequest {
  /** Git service type */
  service: "git-upload-pack" | "git-receive-pack";
  /** Repository path */
  path: string;
  /** Host identifier */
  host: string;
  /** Extra parameters from request */
  extraParams?: Map<string, string>;
}

/**
 * Parse the initial Git protocol request from an input stream.
 *
 * The native git protocol sends the initial request as a single pkt-line:
 * "<service> <path>\0host=<hostname>\0[extra params]\0"
 */
async function parseInitialRequest(input: AsyncIterable<Uint8Array>): Promise<GitProtocolRequest> {
  const packets = pktLineReader(input);
  const firstPacket = await packets.next();

  if (firstPacket.done || firstPacket.value.type !== "data" || !firstPacket.value.data) {
    throw new Error("Invalid initial request: no data received");
  }

  const requestLine = new TextDecoder().decode(firstPacket.value.data);

  // Split by null bytes
  const parts = requestLine.split("\0").filter(Boolean);

  if (parts.length === 0) {
    throw new Error("Invalid initial request: empty request");
  }

  const [servicePath, ...extraParts] = parts;

  // Parse service and path from first part
  const spaceIdx = servicePath.indexOf(" ");
  if (spaceIdx === -1) {
    throw new Error("Invalid initial request: missing path");
  }

  const service = servicePath.slice(0, spaceIdx);
  const path = servicePath.slice(spaceIdx + 1);

  if (service !== "git-upload-pack" && service !== "git-receive-pack") {
    throw new Error(`Invalid service: ${service}`);
  }

  // Parse extra parameters (host=..., version=..., etc.)
  const extraParams = new Map<string, string>();
  let host = "";

  for (const part of extraParts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx !== -1) {
      const key = part.slice(0, eqIdx);
      const value = part.slice(eqIdx + 1);
      if (key === "host") {
        host = value;
      } else {
        extraParams.set(key, value);
      }
    }
  }

  return {
    service: service as "git-upload-pack" | "git-receive-pack",
    path,
    host,
    extraParams: extraParams.size > 0 ? extraParams : undefined,
  };
}

/**
 * Handle a Git socket connection over MessagePort.
 *
 * This function processes Git protocol requests in a loop,
 * handling both upload-pack (fetch) and receive-pack (push) operations.
 * Multiple sequential requests can be processed on the same connection
 * (useful for P2P sync where fetch is followed by push).
 *
 * @param port - The MessagePort for communication
 * @param options - Server options including repository resolver
 * @returns A cleanup function to call when done
 */
export async function handleGitSocketConnection(
  port: MessagePort,
  options: GitSocketServerOptions,
): Promise<() => void> {
  const { resolveRepository, authenticate, logger } = options;

  // Create reader/writer from MessagePort
  const rawInput = createMessagePortReader(port);
  // Wrap input to prevent early termination from closing the underlying iterator
  // This allows the input to be reused for subsequent requests in the loop
  const input = nonClosingIterable(rawInput);
  const write = createMessagePortWriter(port);
  const close = createMessagePortCloser(port, rawInput);

  let disposed = false;

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    close().catch(() => {
      // Ignore close errors
    });
  };

  try {
    // Process requests in a loop until connection closes
    // This allows multiple operations (e.g., fetch then push) on same connection
    while (!disposed) {
      // 1. Parse initial request for this operation
      let request: GitProtocolRequest;
      try {
        request = await parseInitialRequest(input);
      } catch (error) {
        // If we can't parse a request, the connection may be closed
        // This is normal when the peer closes after completing their operations
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("no data received") || message.includes("Invalid initial request")) {
          break;
        }
        throw error;
      }

      logger?.debug?.(`Git request: ${request.service} ${request.path}`);

      // 2. Optional authentication
      if (authenticate) {
        const allowed = await authenticate(request.host, request.path);
        if (!allowed) {
          const errorPacket = encodePacket("ERR access denied\n");
          await write(errorPacket);
          continue; // Try next request
        }
      }

      // 3. Resolve repository
      const repository = await resolveRepository(request.path);
      if (!repository) {
        const errorPacket = encodePacket(`ERR repository not found: ${request.path}\n`);
        await write(errorPacket);
        continue; // Try next request
      }

      // 4. Create handler and process
      if (request.service === "git-upload-pack") {
        const handler = createUploadPackHandler({ repository });

        // Advertise refs (no service announcement for native protocol)
        for await (const chunk of handler.advertise()) {
          await write(chunk);
        }

        // Process the request
        const response = handler.process(input);
        for await (const chunk of response) {
          await write(chunk);
        }

        // Yield to event loop to allow messages to be delivered
        await new Promise((resolve) => setTimeout(resolve, 0));
      } else {
        // receive-pack
        const handler = createReceivePackHandler({ repository });

        // Advertise refs
        for await (const chunk of handler.advertise()) {
          await write(chunk);
        }

        // Process the request
        const response = handler.process(input);
        for await (const chunk of response) {
          await write(chunk);
        }

        // Yield to event loop to allow messages to be delivered
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  } catch (error) {
    logger?.error?.("Git socket error:", error);
    try {
      const message = error instanceof Error ? error.message : String(error);
      await write(encodePacket(`ERR ${message}\n`));
    } catch {
      // Ignore write errors during error handling
    }
    cleanup();
    throw error;
  }

  return cleanup;
}

/**
 * Create a Git socket server that accepts MessagePort connections.
 *
 * The server listens for incoming MessagePort connections
 * and handles each one using the Git protocol.
 *
 * @param acceptor - Async iterable that yields incoming MessagePorts
 * @param options - Server options
 * @returns A server object with close() method
 */
export function createGitSocketServer(
  acceptor: AsyncIterable<MessagePort>,
  options: GitSocketServerOptions,
): { close: () => void } {
  let running = true;
  const activeConnections = new Set<() => void>();

  // Start accepting connections in background
  (async () => {
    for await (const port of acceptor) {
      if (!running) break;

      handleGitSocketConnection(port, options)
        .then((cleanup) => {
          activeConnections.add(cleanup);
        })
        .catch((error) => {
          options.logger?.error?.("Connection error:", error);
        });
    }
  })();

  return {
    close() {
      running = false;
      for (const cleanup of activeConnections) {
        cleanup();
      }
      activeConnections.clear();
    },
  };
}
