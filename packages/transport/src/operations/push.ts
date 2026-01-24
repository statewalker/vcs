/**
 * High-level push operation.
 *
 * Provides a simplified interface for pushing to a remote repository
 * over HTTP/HTTPS.
 */

import type { Credentials } from "../api/credentials.js";

/**
 * An object to push to the remote.
 */
export interface PushObject {
  /** Object ID (hex string) */
  id: string;
  /** Object type code (1=commit, 2=tree, 3=blob, 4=tag) */
  type: number;
  /** Object content */
  content: Uint8Array;
}

/**
 * Options for the push operation.
 */
export interface PushOptions {
  /** Remote URL */
  url: string;
  /** Refspecs to push (e.g., "refs/heads/main:refs/heads/main") */
  refspecs: string[];
  /** Authentication credentials */
  auth?: Credentials;
  /** Additional HTTP headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Force push (allow non-fast-forward) */
  force?: boolean;
  /** Atomic push (all-or-nothing) */
  atomic?: boolean;
  /** Progress message callback */
  onProgressMessage?: (message: string) => void;
  /** Get the object ID for a local ref */
  getLocalRef?: (refName: string) => Promise<string | undefined>;
  /** Get objects to push for given new/old object IDs */
  getObjectsToPush?: (newIds: string[], oldIds: string[]) => AsyncIterable<PushObject>;
}

/**
 * Result of updating a single ref.
 */
export interface RefUpdateResult {
  /** Whether the update succeeded */
  ok: boolean;
  /** Status message from server */
  message?: string;
}

/**
 * Result of a push operation.
 */
export interface PushResult {
  /** Whether the overall push succeeded */
  ok: boolean;
  /** Status of pack unpack on server (if failed) */
  unpackStatus?: string;
  /** Update results for each ref */
  updates: Map<string, RefUpdateResult>;
  /** Total bytes sent */
  bytesSent: number;
  /** Number of objects sent */
  objectCount: number;
}

/**
 * Push objects and refs to a remote repository.
 *
 * @param options - Push options
 * @returns Push result with update status
 *
 * @example
 * ```ts
 * const result = await push({
 *   url: "https://github.com/user/repo.git",
 *   refspecs: ["refs/heads/main:refs/heads/main"],
 *   auth: { token: "ghp_xxx" },
 *   getLocalRef: async (ref) => store.refs.get(ref)?.objectId,
 *   getObjectsToPush: async function* (newIds, oldIds) {
 *     // yield objects reachable from newIds but not oldIds
 *   },
 * });
 *
 * for (const [ref, status] of result.updates) {
 *   console.log(`${ref}: ${status.ok ? "OK" : status.message}`);
 * }
 * ```
 */
export async function push(options: PushOptions): Promise<PushResult> {
  // TODO: Implement HTTP-based push using smart HTTP protocol
  // This would connect to the remote, perform ref advertisement,
  // send pack data, and process push results

  void options; // Suppress unused parameter warning

  throw new Error(
    "HTTP-based push not yet implemented. " +
      "Use pushOverDuplex with an appropriate transport adapter.",
  );
}
