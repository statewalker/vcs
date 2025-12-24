/**
 * High-level fetch operation.
 *
 * Coordinates the complete fetch workflow:
 * 1. Connect to remote
 * 2. Discover refs
 * 3. Negotiate pack
 * 4. Receive and store objects
 * 5. Update local refs
 *
 * Based on JGit's FetchProcess.java
 */

import { bytesToHex } from "@webrun-vcs/utils/hash/utils";
import { openUploadPack } from "../connection/connection-factory.js";
import type { Credentials } from "../connection/types.js";
import {
  buildFetchRequest,
  buildWants,
  generateFetchRequestPackets,
} from "../negotiation/fetch-negotiator.js";
import { getDefaultBranch } from "../negotiation/ref-advertiser.js";
import {
  expandFromSource,
  matchSource,
  parseRefSpec,
  type RefSpec,
} from "../negotiation/refspec.js";
import type { ProgressInfo, RefAdvertisement } from "../protocol/types.js";
import { receivePack } from "../streams/pack-receiver.js";

/**
 * Options for fetch operation.
 */
export interface FetchOptions {
  /** Remote URL */
  url: string;
  /** Refspecs to fetch (default: +refs/heads/*:refs/remotes/origin/*) */
  refspecs?: string[];
  /** Authentication credentials */
  auth?: Credentials;
  /** Custom HTTP headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Shallow clone depth */
  depth?: number;
  /** Progress callback */
  onProgress?: (info: ProgressInfo) => void;
  /** Raw progress message callback */
  onProgressMessage?: (message: string) => void;
  /** Check if we already have an object locally */
  localHas?: (objectId: Uint8Array) => Promise<boolean>;
  /** Get local commit IDs for negotiation */
  localCommits?: () => AsyncIterable<Uint8Array>;
}

/**
 * Result of a fetch operation.
 */
export interface FetchResult {
  /** Refs that were fetched */
  refs: Map<string, Uint8Array>;
  /** Default branch (from HEAD symref) */
  defaultBranch?: string;
  /** Pack data received */
  packData: Uint8Array;
  /** Total bytes transferred */
  bytesReceived: number;
  /** Whether the repository was empty */
  isEmpty: boolean;
}

/**
 * Fetch objects from a remote repository.
 */
export async function fetch(options: FetchOptions): Promise<FetchResult> {
  const {
    url,
    refspecs = ["+refs/heads/*:refs/remotes/origin/*"],
    auth,
    headers,
    timeout,
    depth,
    onProgress,
    onProgressMessage,
    localHas,
    localCommits,
  } = options;

  // Parse refspecs
  const parsedRefspecs = refspecs.map(parseRefSpec);

  // Open connection
  const connection = await openUploadPack(url, {
    auth,
    headers,
    timeout,
  });

  try {
    // Discover refs
    const advertisement = await connection.discoverRefs();

    // Check for empty repository
    if (advertisement.refs.size === 0) {
      return {
        refs: new Map(),
        defaultBranch: getDefaultBranch(advertisement.symrefs),
        packData: new Uint8Array(0),
        bytesReceived: 0,
        isEmpty: true,
      };
    }

    // Build wants based on refspecs
    const wants = await buildWants(advertisement, getWantPatterns(parsedRefspecs), localHas);

    if (wants.length === 0) {
      // Already up to date
      return {
        refs: mapRefsToLocal(advertisement.refs, parsedRefspecs),
        defaultBranch: getDefaultBranch(advertisement.symrefs),
        packData: new Uint8Array(0),
        bytesReceived: 0,
        isEmpty: false,
      };
    }

    // Build haves from local commits
    const haves: Uint8Array[] = [];
    if (localCommits) {
      for await (const commitId of localCommits()) {
        haves.push(commitId);
        if (haves.length >= 256) break;
      }
    }

    // Build fetch request
    const request = buildFetchRequest(wants, advertisement.capabilities, haves, {
      depth,
    });

    // Send request
    await connection.send(generateFetchRequestPackets(request));

    // Receive pack
    const packResult = await receivePack(connection.receive(), {
      onProgress,
      onProgressMessage,
    });

    // Map refs to local names
    const fetchedRefs = mapRefsToLocal(advertisement.refs, parsedRefspecs);

    return {
      refs: fetchedRefs,
      defaultBranch: getDefaultBranch(advertisement.symrefs),
      packData: packResult.packData,
      bytesReceived: packResult.bytesReceived,
      isEmpty: false,
    };
  } finally {
    await connection.close();
  }
}

/**
 * Get patterns for filtering refs based on refspecs.
 */
function getWantPatterns(refspecs: RefSpec[]): string[] {
  const patterns: string[] = [];
  for (const spec of refspecs) {
    if (spec.source) {
      patterns.push(spec.source);
    }
  }
  return patterns;
}

/**
 * Map remote refs to local ref names based on refspecs.
 */
function mapRefsToLocal(
  refs: Map<string, Uint8Array>,
  refspecs: RefSpec[],
): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();

  for (const [refName, objectId] of refs) {
    for (const spec of refspecs) {
      if (matchSource(spec, refName)) {
        const expanded = expandFromSource(spec, refName);
        if (expanded.destination) {
          result.set(expanded.destination, objectId);
        } else {
          result.set(refName, objectId);
        }
        break;
      }
    }
  }

  return result;
}

/**
 * Fetch refs only (without pack data).
 * Useful for checking remote state.
 */
export async function fetchRefs(
  url: string,
  options: Pick<FetchOptions, "auth" | "headers" | "timeout"> = {},
): Promise<RefAdvertisement> {
  const connection = await openUploadPack(url, options);

  try {
    return await connection.discoverRefs();
  } finally {
    await connection.close();
  }
}

/**
 * List remote refs.
 */
export async function lsRemote(
  url: string,
  options: Pick<FetchOptions, "auth" | "headers" | "timeout"> = {},
): Promise<Map<string, string>> {
  const advertisement = await fetchRefs(url, options);
  const result = new Map<string, string>();

  for (const [refName, objectId] of advertisement.refs) {
    result.set(refName, bytesToHex(objectId));
  }

  return result;
}
