/**
 * Connection factory for creating appropriate connections based on URL.
 *
 * Supports multiple transport types:
 * - HTTP/HTTPS: Uses HttpConnection
 * - git://: Uses GitConnection with TCP socket factory
 * - Socket: Uses createGitSocketClient for P2P communication
 */

import { HttpConnection } from "../http/client.js";
import { parseGitUrl } from "../negotiation/uri.js";
import { SERVICE_RECEIVE_PACK, SERVICE_UPLOAD_PACK } from "../protocol/constants.js";
import { TransportError } from "../protocol/errors.js";
import type { GitUrl } from "../protocol/types.js";
import { createGitSocketClient } from "../socket/client.js";
import type { Credentials, DiscoverableConnection } from "./types.js";

/**
 * Options for the connection factory.
 */
export interface FactoryOptions {
  /** Authentication credentials */
  auth?: Credentials;
  /** Custom HTTP headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** User agent string */
  userAgent?: string;
}

/**
 * Create appropriate connection based on URL protocol.
 */
export function createConnection(
  url: string | GitUrl,
  options: FactoryOptions = {},
): {
  openUploadPack(): Promise<DiscoverableConnection>;
  openReceivePack(): Promise<DiscoverableConnection>;
} {
  const parsed = typeof url === "string" ? parseGitUrl(url) : url;

  return {
    async openUploadPack(): Promise<DiscoverableConnection> {
      return openConnection(parsed, SERVICE_UPLOAD_PACK, options);
    },
    async openReceivePack(): Promise<DiscoverableConnection> {
      return openConnection(parsed, SERVICE_RECEIVE_PACK, options);
    },
  };
}

/**
 * Open a connection for the specified service.
 */
async function openConnection(
  url: GitUrl,
  service: "git-upload-pack" | "git-receive-pack",
  options: FactoryOptions,
): Promise<DiscoverableConnection> {
  switch (url.protocol) {
    case "https":
    case "http": {
      const httpUrl = formatHttpUrl(url);
      return new HttpConnection({
        url: httpUrl,
        service,
        auth: options.auth,
        headers: options.headers,
        timeout: options.timeout,
        userAgent: options.userAgent,
      });
    }

    case "git":
      throw new TransportError(
        "Native git:// protocol is not supported. Use HTTPS instead, or use " +
          "createGitSocketClient() with a MessagePort for P2P communication.",
      );

    case "ssh":
      throw new TransportError("SSH protocol not yet implemented. Use HTTPS instead.");

    case "file":
      throw new TransportError("Local file transport not available. Use storage APIs directly.");

    default:
      throw new TransportError(`Unknown protocol: ${url.protocol}`);
  }
}

/**
 * Format URL for HTTP transport.
 */
function formatHttpUrl(url: GitUrl): string {
  let result = `${url.protocol}://`;

  if (url.user) {
    result += encodeURIComponent(url.user);
    if (url.password) {
      result += `:${encodeURIComponent(url.password)}`;
    }
    result += "@";
  }

  result += url.host;

  if (url.port) {
    const defaultPort = url.protocol === "https" ? 443 : 80;
    if (url.port !== defaultPort) {
      result += `:${url.port}`;
    }
  }

  result += url.path;

  return result;
}

/**
 * Quick helper to open upload-pack connection.
 */
export async function openUploadPack(
  url: string,
  options: FactoryOptions = {},
): Promise<DiscoverableConnection> {
  const factory = createConnection(url, options);
  return factory.openUploadPack();
}

/**
 * Quick helper to open receive-pack connection.
 */
export async function openReceivePack(
  url: string,
  options: FactoryOptions = {},
): Promise<DiscoverableConnection> {
  const factory = createConnection(url, options);
  return factory.openReceivePack();
}

// =============================================================================
// MessagePort-based connections (for P2P communication)
// =============================================================================

/**
 * Open upload-pack connection from a MessagePort.
 *
 * Use this for P2P communication where you have a pre-established
 * MessagePort (e.g., from a MessageChannel or worker).
 *
 * @param port - The MessagePort to use for communication
 * @param path - Repository path (e.g., "/repo.git")
 * @param host - Optional host identifier (defaults to "localhost")
 * @returns DiscoverableConnection for fetch operations
 */
export function openUploadPackFromSocket(
  port: MessagePort,
  path: string,
  host = "localhost",
): DiscoverableConnection {
  return createGitSocketClient(port, {
    path,
    host,
    service: "git-upload-pack",
  });
}

/**
 * Open receive-pack connection from a MessagePort.
 *
 * Use this for P2P communication where you have a pre-established
 * MessagePort (e.g., from a MessageChannel or worker).
 *
 * @param port - The MessagePort to use for communication
 * @param path - Repository path (e.g., "/repo.git")
 * @param host - Optional host identifier (defaults to "localhost")
 * @returns DiscoverableConnection for push operations
 */
export function openReceivePackFromSocket(
  port: MessagePort,
  path: string,
  host = "localhost",
): DiscoverableConnection {
  return createGitSocketClient(port, {
    path,
    host,
    service: "git-receive-pack",
  });
}
