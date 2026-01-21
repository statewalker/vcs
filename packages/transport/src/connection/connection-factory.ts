/**
 * Connection factory for creating appropriate connections based on URL.
 */

import { parseGitUrl } from "../negotiation/uri.js";
import { SERVICE_RECEIVE_PACK, SERVICE_UPLOAD_PACK } from "../protocol/constants.js";
import { TransportError } from "../protocol/errors.js";
import type { GitUrl } from "../protocol/types.js";
import { GitConnection, type TcpSocket } from "./git-connection.js";
import { HttpConnection } from "./http-connection.js";
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
  /** Factory for TCP sockets (needed for git:// protocol) */
  tcpSocketFactory?: (host: string, port: number) => TcpSocket;
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

    case "git": {
      if (!options.tcpSocketFactory) {
        throw new TransportError("git:// protocol requires tcpSocketFactory option");
      }
      const factory = options.tcpSocketFactory;
      const conn = new GitConnection(
        {
          host: url.host,
          port: url.port,
          path: url.path,
          service,
        },
        () => factory(url.host, url.port ?? 9418),
      );
      // For git protocol, we need to connect immediately to discover refs
      return conn;
    }

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
