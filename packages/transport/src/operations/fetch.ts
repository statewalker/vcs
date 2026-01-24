/**
 * High-level fetch operation.
 *
 * Provides a simplified interface for fetching from a remote repository
 * over HTTP/HTTPS.
 */

import type { Credentials, ProgressInfo } from "../api/credentials.js";

/**
 * Authentication credentials for transport operations.
 * @deprecated Use Credentials from api/credentials.js instead
 */
export type TransportAuth = Credentials;

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
  // TODO: Implement HTTP-based fetch using smart HTTP protocol
  // This would connect to the remote, perform ref advertisement,
  // negotiate wants/haves, and download pack data

  void options; // Suppress unused parameter warning

  throw new Error(
    "HTTP-based fetch not yet implemented. " +
      "Use fetchOverDuplex with an appropriate transport adapter.",
  );
}
