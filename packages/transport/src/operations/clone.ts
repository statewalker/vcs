/**
 * High-level clone operation.
 *
 * Provides a simplified interface for cloning a remote repository
 * over HTTP/HTTPS.
 */

import type { Credentials, ProgressInfo } from "../api/credentials.js";

/**
 * Options for the clone operation.
 */
export interface CloneOptions {
  /** Remote URL to clone from */
  url: string;
  /** Branch to clone (if not specified, uses default branch) */
  branch?: string;
  /** Authentication credentials */
  auth?: Credentials;
  /** Additional HTTP headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Shallow clone depth (omit for full clone) */
  depth?: number;
  /** Create a bare repository */
  bare?: boolean;
  /** Name to give the remote (default: "origin") */
  remoteName?: string;
  /** Progress callback */
  onProgress?: (info: ProgressInfo) => void;
  /** Progress message callback */
  onProgressMessage?: (message: string) => void;
}

/**
 * Result of a clone operation.
 */
export interface CloneResult {
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
 * Clone a remote repository.
 *
 * Performs an initial fetch of all refs and objects from a remote repository.
 *
 * @param options - Clone options
 * @returns Clone result with refs and pack data
 *
 * @example
 * ```ts
 * const result = await clone({
 *   url: "https://github.com/user/repo.git",
 * });
 *
 * console.log("Default branch:", result.defaultBranch);
 * console.log("Bytes received:", result.bytesReceived);
 * ```
 */
export async function clone(options: CloneOptions): Promise<CloneResult> {
  // TODO: Implement HTTP-based clone using smart HTTP protocol
  // This would connect to the remote, perform ref advertisement,
  // and download all objects

  void options; // Suppress unused parameter warning

  throw new Error(
    "HTTP-based clone not yet implemented. " +
      "Use fetchOverDuplex with an appropriate transport adapter.",
  );
}
