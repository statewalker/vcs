/**
 * Shallow clone negotiation for upload-pack protocol.
 *
 * Handles shallow clone operations including:
 * - deepen (depth limit)
 * - deepen-since (timestamp limit)
 * - deepen-not (exclude refs)
 * - deepen-relative (relative to client's shallow commits)
 *
 * Based on JGit's UploadPack.computeShallowsAndUnshallows()
 */

import type { ObjectId, RepositoryAccess } from "./types.js";

/**
 * Shallow request parameters from client.
 */
export interface ShallowRequest {
  /** Depth limit (0 = not set) */
  depth: number;
  /** Unix timestamp for deepen-since (0 = not set) */
  deepenSince: number;
  /** Ref names to exclude (deepen-not) */
  deepenNots: string[];
  /** Whether depth is relative to client's shallow commits */
  deepenRelative: boolean;
  /** Commits the client already has as shallow */
  clientShallowCommits: Set<ObjectId>;
}

/**
 * Result of shallow boundary computation.
 */
export interface ShallowBoundaryResult {
  /** New commits that should be shallow for the client */
  shallowCommits: ObjectId[];
  /** Previously shallow commits that are now unshallowed */
  unshallowCommits: ObjectId[];
}

/**
 * Create default shallow request (no shallow constraints).
 */
export function createDefaultShallowRequest(): ShallowRequest {
  return {
    depth: 0,
    deepenSince: 0,
    deepenNots: [],
    deepenRelative: false,
    clientShallowCommits: new Set(),
  };
}

/**
 * Check if the request has any shallow constraints.
 */
export function hasShallowConstraints(request: ShallowRequest): boolean {
  return request.depth > 0 || request.deepenSince > 0 || request.deepenNots.length > 0;
}

/**
 * Format a shallow packet for the protocol.
 */
export function formatShallowPacket(objectId: ObjectId): string {
  return `shallow ${objectId}\n`;
}

/**
 * Format an unshallow packet for the protocol.
 */
export function formatUnshallowPacket(objectId: ObjectId): string {
  return `unshallow ${objectId}\n`;
}

/**
 * Compute shallow boundary for the given request.
 *
 * This determines which commits should be marked as shallow and which
 * previously shallow commits should be unshallowed based on the
 * client's request.
 *
 * @param repository - Repository access
 * @param wants - Object IDs the client wants
 * @param request - Shallow request parameters
 * @returns Shallow and unshallow commits
 */
export async function computeShallowBoundary(
  repository: RepositoryAccess,
  wants: ObjectId[],
  request: ShallowRequest,
): Promise<ShallowBoundaryResult> {
  const shallowCommits: ObjectId[] = [];
  const unshallowCommits: ObjectId[] = [];

  if (!hasShallowConstraints(request)) {
    return { shallowCommits, unshallowCommits };
  }

  // For depth-based shallow clones
  if (request.depth > 0) {
    // Walk from wants up to depth, marking commits at the boundary as shallow
    const visited = new Set<ObjectId>();
    const boundary = new Set<ObjectId>();

    // Simple BFS walk with depth tracking
    interface QueueEntry {
      id: ObjectId;
      currentDepth: number;
    }

    const queue: QueueEntry[] = wants.map((id) => ({
      id,
      currentDepth: 0,
    }));

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;
      const { id, currentDepth } = item;

      if (visited.has(id)) continue;
      visited.add(id);

      // Get object info to check if it's a commit
      const objInfo = await repository.getObjectInfo(id);
      if (!objInfo || objInfo.type !== 1) {
        // type 1 = commit
        continue;
      }

      if (currentDepth >= request.depth - 1) {
        // This commit is at the shallow boundary
        // Only add if client doesn't already have it as shallow
        if (!request.clientShallowCommits.has(id)) {
          boundary.add(id);
        }
        continue;
      }

      // Parse commit to get parents
      const parents = await getCommitParents(repository, id);
      for (const parentId of parents) {
        if (!visited.has(parentId)) {
          queue.push({ id: parentId, currentDepth: currentDepth + 1 });
        }
      }
    }

    shallowCommits.push(...boundary);

    // Check for commits that should be unshallowed
    // (commits that were shallow but are now within the depth limit)
    for (const clientShallow of request.clientShallowCommits) {
      if (visited.has(clientShallow) && !boundary.has(clientShallow)) {
        // Client had this as shallow, but it's now within our depth limit
        unshallowCommits.push(clientShallow);
      }
    }
  }

  // For time-based shallow clones (deepen-since)
  if (request.deepenSince > 0) {
    const visited = new Set<ObjectId>();
    const boundary = new Set<ObjectId>();

    const queue: ObjectId[] = [...wants];

    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) continue;

      if (visited.has(id)) continue;
      visited.add(id);

      // Get commit timestamp
      const commitTime = await getCommitTime(repository, id);
      if (commitTime === null) continue;

      if (commitTime < request.deepenSince) {
        // This commit is before the cutoff - mark as shallow boundary
        if (!request.clientShallowCommits.has(id)) {
          boundary.add(id);
        }
        continue;
      }

      // Continue walking parents
      const parents = await getCommitParents(repository, id);
      for (const parentId of parents) {
        if (!visited.has(parentId)) {
          queue.push(parentId);
        }
      }
    }

    // Add boundary commits (only if not already added by depth)
    for (const id of boundary) {
      if (!shallowCommits.includes(id)) {
        shallowCommits.push(id);
      }
    }

    // Check for unshallows
    for (const clientShallow of request.clientShallowCommits) {
      const commitTime = await getCommitTime(repository, clientShallow);
      if (commitTime !== null && commitTime >= request.deepenSince) {
        if (!unshallowCommits.includes(clientShallow)) {
          unshallowCommits.push(clientShallow);
        }
      }
    }
  }

  // For deepen-not (exclude specific refs)
  if (request.deepenNots.length > 0) {
    // Resolve deepen-not refs to commit IDs
    const excludeCommits = new Set<ObjectId>();
    for await (const ref of repository.listRefs()) {
      for (const excludeRef of request.deepenNots) {
        if (ref.name === excludeRef || ref.name.endsWith(`/${excludeRef}`)) {
          excludeCommits.add(ref.objectId);
          // Also collect all ancestors of excluded refs
          const ancestors = await collectAncestors(repository, ref.objectId);
          for (const ancestor of ancestors) {
            excludeCommits.add(ancestor);
          }
        }
      }
    }

    // Mark commits that would cross into excluded territory as shallow
    const visited = new Set<ObjectId>();
    const queue: ObjectId[] = [...wants];

    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) continue;

      if (visited.has(id)) continue;
      visited.add(id);

      if (excludeCommits.has(id)) {
        // This commit is in the excluded set - mark as shallow boundary
        if (!request.clientShallowCommits.has(id) && !shallowCommits.includes(id)) {
          shallowCommits.push(id);
        }
        continue;
      }

      // Continue walking parents
      const parents = await getCommitParents(repository, id);
      for (const parentId of parents) {
        if (!visited.has(parentId)) {
          queue.push(parentId);
        }
      }
    }
  }

  return { shallowCommits, unshallowCommits };
}

/**
 * Get parent commit IDs from a commit object.
 */
async function getCommitParents(
  repository: RepositoryAccess,
  commitId: ObjectId,
): Promise<ObjectId[]> {
  const parents: ObjectId[] = [];

  try {
    const chunks: Uint8Array[] = [];
    for await (const chunk of repository.loadObject(commitId)) {
      chunks.push(chunk);
    }

    const content = concatBytes(chunks);
    const text = new TextDecoder().decode(content);

    // Parse parent lines from commit object
    for (const line of text.split("\n")) {
      if (line.startsWith("parent ")) {
        parents.push(line.slice(7).trim());
      } else if (line === "") {
        // End of header
        break;
      }
    }
  } catch {
    // Commit not found or error parsing
  }

  return parents;
}

/**
 * Get commit timestamp (author time in seconds since epoch).
 */
async function getCommitTime(
  repository: RepositoryAccess,
  commitId: ObjectId,
): Promise<number | null> {
  try {
    const chunks: Uint8Array[] = [];
    for await (const chunk of repository.loadObject(commitId)) {
      chunks.push(chunk);
    }

    const content = concatBytes(chunks);
    const text = new TextDecoder().decode(content);

    // Parse committer line to get timestamp
    for (const line of text.split("\n")) {
      if (line.startsWith("committer ")) {
        // Format: "committer Name <email> timestamp timezone"
        const match = line.match(/(\d+)\s+[+-]\d{4}$/);
        if (match) {
          return parseInt(match[1], 10);
        }
      } else if (line === "") {
        break;
      }
    }
  } catch {
    // Commit not found or error parsing
  }

  return null;
}

/**
 * Collect all ancestors of a commit.
 */
async function collectAncestors(
  repository: RepositoryAccess,
  startId: ObjectId,
  maxDepth = 1000,
): Promise<Set<ObjectId>> {
  const ancestors = new Set<ObjectId>();
  const queue: Array<{ id: ObjectId; depth: number }> = [{ id: startId, depth: 0 }];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;
    const { id, depth } = item;

    if (ancestors.has(id) || depth > maxDepth) continue;
    ancestors.add(id);

    const parents = await getCommitParents(repository, id);
    for (const parentId of parents) {
      queue.push({ id: parentId, depth: depth + 1 });
    }
  }

  return ancestors;
}

/**
 * Concatenate byte arrays.
 */
function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
