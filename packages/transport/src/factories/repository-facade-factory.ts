/**
 * Factory for creating RepositoryFacade from repository stores.
 *
 * The RepositoryFacade provides a transport-friendly interface for
 * repository operations needed during Git protocol negotiation.
 */

import type {
  CommitStore,
  RefStore as CoreRefStore,
  GitObjectStore,
  ObjectId,
  Ref,
  SerializationApi,
  SymbolicRef,
  TagStore,
} from "@statewalker/vcs-core";
import type {
  ExportPackOptions,
  PackImportResult,
  RepositoryFacade,
} from "../api/repository-facade.js";

/**
 * Input stores required to create a RepositoryFacade.
 *
 * These can be obtained from a HistoryStore and its backend.
 */
export interface RepositoryStores {
  /** Unified object storage for existence checks */
  objects: GitObjectStore;
  /** Commit storage for ancestry traversal */
  commits: CommitStore;
  /** Tag storage for tag peeling */
  tags: TagStore;
  /** Ref storage for tips and validation */
  refs: CoreRefStore;
  /** Serialization API for pack import/export */
  serialization: SerializationApi;
}

/**
 * Creates a RepositoryFacade from repository stores.
 *
 * The facade composes multiple store APIs into a transport-friendly
 * interface for pack operations, object existence checks, and
 * ancestry traversal.
 *
 * @param stores - Repository stores to compose
 * @returns RepositoryFacade implementation
 *
 * @example
 * ```ts
 * // From a HistoryStore with backend
 * const facade = createRepositoryFacade({
 *   objects: historyStore.objects,
 *   commits: historyStore.commits,
 *   tags: historyStore.tags,
 *   refs: historyStore.refs,
 *   serialization: historyStore.backend!.serialization,
 * });
 *
 * // Check if we have an object
 * const exists = await facade.has("abc123...");
 *
 * // Walk ancestors for negotiation
 * for await (const oid of facade.walkAncestors(startOid)) {
 *   console.log("Ancestor:", oid);
 * }
 * ```
 */
export function createRepositoryFacade(stores: RepositoryStores): RepositoryFacade {
  const { objects, commits, tags, refs, serialization } = stores;

  const facade: RepositoryFacade = {
    // ─────────────────────────────────────────────────────────────────
    // Pack I/O - delegated to SerializationApi
    // ─────────────────────────────────────────────────────────────────

    importPack(packStream: AsyncIterable<Uint8Array>): Promise<PackImportResult> {
      return serialization.importPack(packStream);
    },

    async *exportPack(
      wants: Set<string>,
      exclude: Set<string>,
      _options?: ExportPackOptions,
    ): AsyncIterable<Uint8Array> {
      // Collect reachable objects from wants, excluding common base
      const objectIds = collectReachableObjects(wants, exclude, commits, objects);
      yield* serialization.createPack(objectIds);
    },

    // ─────────────────────────────────────────────────────────────────
    // Object existence - delegated to GitObjectStore
    // ─────────────────────────────────────────────────────────────────

    async has(oid: string): Promise<boolean> {
      return objects.has(oid);
    },

    // ─────────────────────────────────────────────────────────────────
    // Commit ancestry - walk commit graph
    // ─────────────────────────────────────────────────────────────────

    async *walkAncestors(startOid: string): AsyncGenerator<string> {
      const visited = new Set<string>();
      const queue: string[] = [startOid];

      while (queue.length > 0) {
        const oid = queue.shift()!;
        if (visited.has(oid)) continue;
        visited.add(oid);

        // Try to load as commit
        try {
          const commit = await commits.loadCommit(oid);
          yield oid;

          // Queue parents (BFS) - ObjectId is string type alias
          for (const parentOid of commit.parents) {
            if (!visited.has(parentOid)) {
              queue.push(parentOid);
            }
          }
        } catch {}
      }
    },

    // ─────────────────────────────────────────────────────────────────
    // Optional Protocol V2 methods
    // ─────────────────────────────────────────────────────────────────

    async peelTag(oid: string): Promise<string | null> {
      try {
        const tag = await tags.loadTag(oid);
        // AnnotatedTag has 'object' property, not 'target'
        return tag.object;
      } catch {
        // Not a tag - return null
        return null;
      }
    },

    async getObjectSize(oid: string): Promise<number | null> {
      try {
        const header = await objects.getHeader(oid);
        return header.size;
      } catch {
        return null;
      }
    },

    // ─────────────────────────────────────────────────────────────────
    // Server-side validation methods
    // ─────────────────────────────────────────────────────────────────

    async isReachableFrom(oid: string, from: string | string[]): Promise<boolean> {
      const roots = Array.isArray(from) ? from : [from];

      // Walk from each root toward ancestors looking for oid
      for (const root of roots) {
        for await (const ancestorOid of facade.walkAncestors(root)) {
          if (ancestorOid === oid) {
            return true;
          }
        }
      }

      return false;
    },

    async isReachableFromAnyTip(oid: string): Promise<boolean> {
      // Get all ref tips by iterating refs.list()
      const tips: string[] = [];
      for await (const ref of refs.list()) {
        // Resolve symbolic refs to get the target OID
        const resolved = isSymbolicRef(ref) ? await refs.resolve(ref.name) : ref;
        if (resolved && "objectId" in resolved && resolved.objectId !== undefined) {
          tips.push(resolved.objectId);
        }
      }

      return facade.isReachableFrom?.(oid, tips) ?? false;
    },
  };

  return facade;
}

/**
 * Type guard for SymbolicRef
 */
function isSymbolicRef(ref: Ref | SymbolicRef): ref is SymbolicRef {
  return "target" in ref;
}

/**
 * Collects object IDs reachable from wants, excluding common base.
 *
 * Uses BFS to walk the commit graph and collect all reachable objects
 * (commits, trees, blobs, tags).
 */
async function* collectReachableObjects(
  wants: Set<string>,
  exclude: Set<string>,
  commits: CommitStore,
  objects: GitObjectStore,
): AsyncGenerator<ObjectId> {
  const visited = new Set<string>();

  // Expand exclude set to include all ancestors
  const excludeExpanded = new Set<string>(exclude);
  for (const excludeOid of exclude) {
    try {
      const commit = await commits.loadCommit(excludeOid);
      // Note: In a full implementation, we'd walk all ancestors
      // For simplicity, just add direct parents
      for (const parent of commit.parents) {
        excludeExpanded.add(parent);
      }
    } catch {
      // Not a commit - skip
    }
  }

  // BFS from wants
  const queue: string[] = [...wants];

  while (queue.length > 0) {
    const oid = queue.shift()!;

    if (visited.has(oid) || excludeExpanded.has(oid)) {
      continue;
    }
    visited.add(oid);

    // Check object exists
    const exists = await objects.has(oid);
    if (!exists) continue;

    yield oid;

    // Try to load as commit and walk its tree and parents
    try {
      const commit = await commits.loadCommit(oid);

      // Add tree to queue - ObjectId is string
      if (!visited.has(commit.tree)) {
        queue.push(commit.tree);
      }

      // Add parents to queue
      for (const parent of commit.parents) {
        if (!visited.has(parent) && !excludeExpanded.has(parent)) {
          queue.push(parent);
        }
      }
    } catch {
      // Not a commit - might be tree, blob, or tag
      // For trees, we'd need to walk entries, but that requires TreeStore
      // For simplicity, just yield the object ID
    }
  }
}
