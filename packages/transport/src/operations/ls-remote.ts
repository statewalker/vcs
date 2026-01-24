/**
 * High-level ls-remote operation.
 *
 * Lists references in a remote repository without downloading objects.
 */

import type { Credentials } from "../api/credentials.js";

/**
 * Options for ls-remote operation.
 */
export interface LsRemoteOptions {
  /** Authentication credentials */
  auth?: Credentials;
  /** Additional HTTP headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * List references in a remote repository.
 *
 * Connects to the remote and retrieves the list of refs without
 * downloading any objects.
 *
 * @param url - Remote repository URL
 * @param options - Optional settings
 * @returns Map of ref names to object ID hex strings
 *
 * @example
 * ```ts
 * const refs = await lsRemote("https://github.com/user/repo.git");
 *
 * for (const [refName, objectId] of refs) {
 *   console.log(`${refName} -> ${objectId}`);
 * }
 * ```
 */
export async function lsRemote(
  url: string,
  options?: LsRemoteOptions,
): Promise<Map<string, string>> {
  // TODO: Implement HTTP-based ls-remote using smart HTTP protocol
  // This would connect to the remote and fetch ref advertisement

  void url; // Suppress unused parameter warning
  void options; // Suppress unused parameter warning

  throw new Error(
    "HTTP-based ls-remote not yet implemented. " +
      "Use a transport adapter to connect to the remote.",
  );
}
