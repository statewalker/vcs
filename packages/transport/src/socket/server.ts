/**
 * Git socket server implementation.
 *
 * Handles Git protocol connections over BidirectionalSocket.
 * Suitable for P2P synchronization where both peers communicate
 * over a MessagePort-based socket.
 */

import { createReceivePackHandler } from "../handlers/receive-pack-handler.js";
import type { RepositoryAccess } from "../handlers/types.js";
import { createUploadPackHandler } from "../handlers/upload-pack-handler.js";
import { encodePacket, pktLineReader } from "../protocol/pkt-line-codec.js";
import type { BidirectionalSocket } from "./types.js";

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
 * Parse the initial Git protocol request from a socket.
 *
 * The native git protocol sends the initial request as a single pkt-line:
 * "<service> <path>\0host=<hostname>\0[extra params]\0"
 */
async function parseInitialRequest(socket: BidirectionalSocket): Promise<GitProtocolRequest> {
  const packets = pktLineReader(socket.read());
  const iterator = packets[Symbol.asyncIterator]();
  const firstPacket = await iterator.next();

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
 * Handle a single Git socket connection.
 *
 * This function processes the Git protocol handshake and request,
 * handling both upload-pack (fetch) and receive-pack (push) operations.
 *
 * @param socket - The bidirectional socket for communication
 * @param options - Server options including repository resolver
 * @returns A cleanup function to call when done
 */
export async function handleGitSocketConnection(
  socket: BidirectionalSocket,
  options: GitSocketServerOptions,
): Promise<() => void> {
  const { resolveRepository, authenticate, logger } = options;

  let disposed = false;

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    socket.close().catch(() => {
      // Ignore close errors
    });
  };

  try {
    // 1. Parse initial request
    const request = await parseInitialRequest(socket);
    logger?.debug?.(`Git request: ${request.service} ${request.path}`);

    // 2. Optional authentication
    if (authenticate) {
      const allowed = await authenticate(request.host, request.path);
      if (!allowed) {
        const errorPacket = encodePacket("ERR access denied\n");
        await socket.write(errorPacket);
        await socket.close();
        return cleanup;
      }
    }

    // 3. Resolve repository
    const repository = await resolveRepository(request.path);
    if (!repository) {
      const errorPacket = encodePacket(`ERR repository not found: ${request.path}\n`);
      await socket.write(errorPacket);
      await socket.close();
      return cleanup;
    }

    // 4. Create handler and process
    if (request.service === "git-upload-pack") {
      const handler = createUploadPackHandler({ repository });

      // Advertise refs (no service announcement for native protocol)
      for await (const chunk of handler.advertise()) {
        await socket.write(chunk);
      }

      // Process the request
      const response = handler.process(socket.read());
      for await (const chunk of response) {
        await socket.write(chunk);
      }
    } else {
      // receive-pack
      const handler = createReceivePackHandler({ repository });

      // Advertise refs
      for await (const chunk of handler.advertise()) {
        await socket.write(chunk);
      }

      // Process the request
      const response = handler.process(socket.read());
      for await (const chunk of response) {
        await socket.write(chunk);
      }
    }

    await socket.close();
  } catch (error) {
    logger?.error?.("Git socket error:", error);
    try {
      const message = error instanceof Error ? error.message : String(error);
      await socket.write(encodePacket(`ERR ${message}\n`));
    } catch {
      // Ignore write errors during error handling
    }
    cleanup();
    throw error;
  }

  return cleanup;
}

/**
 * Create a Git socket server that accepts connections.
 *
 * The server listens for incoming BidirectionalSocket connections
 * and handles each one using the Git protocol.
 *
 * @param acceptor - Async iterable that yields incoming sockets
 * @param options - Server options
 * @returns A server object with close() method
 */
export function createGitSocketServer(
  acceptor: AsyncIterable<BidirectionalSocket>,
  options: GitSocketServerOptions,
): { close: () => void } {
  let running = true;
  const activeConnections = new Set<() => void>();

  // Start accepting connections in background
  (async () => {
    for await (const socket of acceptor) {
      if (!running) break;

      handleGitSocketConnection(socket, options)
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
