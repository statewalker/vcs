/**
 * High-level clone operation.
 *
 * Clone is essentially:
 * 1. Initialize empty repository
 * 2. Fetch all refs from remote
 * 3. Set up remote tracking
 * 4. Checkout default branch (optional)
 *
 * Based on JGit's CloneCommand.java
 */

import type { Credentials } from "../connection/types.js";
import { getDefaultBranch } from "../negotiation/ref-advertiser.js";
import type { ProgressInfo } from "../protocol/types.js";
import { fetch, fetchRefs } from "./fetch.js";

/**
 * Options for clone operation.
 */
export interface CloneOptions {
  /** Remote URL to clone from */
  url: string;
  /** Clone only specified branch */
  branch?: string;
  /** Shallow clone depth */
  depth?: number;
  /** Create bare repository (no working tree) */
  bare?: boolean;
  /** Remote name (default: "origin") */
  remoteName?: string;
  /** Authentication credentials */
  auth?: Credentials;
  /** Custom HTTP headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Progress callback */
  onProgress?: (info: ProgressInfo) => void;
  /** Raw progress message callback */
  onProgressMessage?: (message: string) => void;
}

/**
 * Result of a clone operation.
 */
export interface CloneResult {
  /** Refs that were fetched */
  refs: Map<string, Uint8Array>;
  /** Default branch name */
  defaultBranch: string;
  /** Pack data received */
  packData: Uint8Array;
  /** Total bytes transferred */
  bytesReceived: number;
  /** Whether the repository was empty */
  isEmpty: boolean;
  /** Remote name used */
  remoteName: string;
  /** Remote URL */
  remoteUrl: string;
}

/**
 * Clone a remote repository.
 *
 * This performs a full fetch of all refs (or specified branch)
 * and returns the pack data for storage.
 */
export async function clone(options: CloneOptions): Promise<CloneResult> {
  const {
    url,
    branch,
    depth,
    // bare = false, // TODO: Implement bare repository support
    remoteName = "origin",
    auth,
    headers,
    timeout,
    onProgress,
    onProgressMessage,
  } = options;

  // Build refspecs
  let refspecs: string[];
  if (branch) {
    // Clone single branch
    refspecs = [`+refs/heads/${branch}:refs/remotes/${remoteName}/${branch}`];
  } else {
    // Clone all branches
    refspecs = [`+refs/heads/*:refs/remotes/${remoteName}/*`, `+refs/tags/*:refs/tags/*`];
  }

  // Fetch from remote
  const fetchResult = await fetch({
    url,
    refspecs,
    auth,
    headers,
    timeout,
    depth,
    onProgress,
    onProgressMessage,
  });

  // Determine default branch
  let defaultBranch = fetchResult.defaultBranch;
  if (!defaultBranch && branch) {
    defaultBranch = branch;
  }
  if (!defaultBranch) {
    // Guess from refs
    defaultBranch = guessDefaultBranch(fetchResult.refs, remoteName);
  }

  return {
    refs: fetchResult.refs,
    defaultBranch: defaultBranch || "main",
    packData: fetchResult.packData,
    bytesReceived: fetchResult.bytesReceived,
    isEmpty: fetchResult.isEmpty,
    remoteName,
    remoteUrl: url,
  };
}

/**
 * Guess the default branch from available refs.
 */
function guessDefaultBranch(refs: Map<string, Uint8Array>, remoteName: string): string | undefined {
  const candidates = ["main", "master", "develop", "trunk"];

  for (const name of candidates) {
    if (refs.has(`refs/remotes/${remoteName}/${name}`)) {
      return name;
    }
    if (refs.has(`refs/heads/${name}`)) {
      return name;
    }
  }

  // Return first branch found
  for (const refName of refs.keys()) {
    const match = refName.match(/^refs\/remotes\/[^/]+\/(.+)$/);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * Check if a repository exists and is accessible.
 */
export async function checkRemote(
  url: string,
  options: Pick<CloneOptions, "auth" | "headers" | "timeout"> = {},
): Promise<{
  exists: boolean;
  isEmpty: boolean;
  defaultBranch?: string;
  error?: string;
}> {
  try {
    const advertisement = await fetchRefs(url, options);
    const defaultBranch = getDefaultBranch(advertisement.symrefs);

    return {
      exists: true,
      isEmpty: advertisement.refs.size === 0,
      defaultBranch,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("not found") || message.includes("404")) {
      return {
        exists: false,
        isEmpty: true,
        error: "Repository not found",
      };
    }

    if (message.includes("authentication") || message.includes("401") || message.includes("403")) {
      return {
        exists: true, // Might exist but we can't access it
        isEmpty: false,
        error: "Authentication required",
      };
    }

    return {
      exists: false,
      isEmpty: true,
      error: message,
    };
  }
}
