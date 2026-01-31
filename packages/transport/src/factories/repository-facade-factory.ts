/**
 * Factory for creating RepositoryFacade from repository stores.
 *
 * The RepositoryFacade provides a transport-friendly interface for
 * repository operations needed during Git protocol negotiation.
 *
 * Supports both:
 * - New History facade (recommended) - uses collectReachableObjects()
 * - Legacy HistoryStore/RepositoryStores (deprecated) - uses internal traversal
 */

import type {
  CommitStore,
  RefStore as CoreRefStore,
  HistoryStore,
  HistoryWithBackend,
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
 * Configuration for creating RepositoryFacade using History facade (recommended)
 */
export interface HistoryFacadeConfig {
  /** History facade for object access */
  history: HistoryWithBackend;
}

/**
 * Input stores required to create a RepositoryFacade.
 *
 * @deprecated Use HistoryFacadeConfig with History instead
 * These can be obtained from a HistoryStore and its backend.
 */
export interface RepositoryStores {
  /** Commit storage for ancestry traversal */
  commits: CommitStore;
  /** Tag storage for tag peeling */
  tags: TagStore;
  /** Ref storage for tips and validation */
  refs: CoreRefStore;
  /** Serialization API for pack import/export */
  serialization: SerializationApi;
  /** @deprecated Objects store - no longer needed, kept for compatibility */
  objects?: {
    has(id: ObjectId): Promise<boolean>;
    getHeader?(id: ObjectId): Promise<{ size: number }>;
  };
}

/**
 * Creates a RepositoryFacade from History facade with backend (recommended).
 *
 * This is the recommended factory method. Uses History.collectReachableObjects()
 * for efficient object graph traversal during pack export.
 *
 * @param config - History facade configuration
 * @returns RepositoryFacade implementation
 *
 * @example
 * ```ts
 * const facade = createRepositoryFacade({ history });
 *
 * // Check if we have an object
 * const exists = await facade.has("abc123...");
 *
 * // Export pack
 * const packStream = facade.exportPack(wants, exclude);
 * ```
 */
export function createRepositoryFacade(config: HistoryFacadeConfig): RepositoryFacade;

/**
 * Creates a RepositoryFacade from a HistoryStore.
 *
 * @deprecated Use HistoryFacadeConfig with History instead
 * @param history - HistoryStore with backend
 * @returns RepositoryFacade implementation
 * @throws Error if history has no backend
 */
export function createRepositoryFacade(history: HistoryStore): RepositoryFacade;

/**
 * Creates a RepositoryFacade from repository stores.
 *
 * @deprecated Use HistoryFacadeConfig with History instead
 * @param stores - Repository stores to compose
 * @returns RepositoryFacade implementation
 */
export function createRepositoryFacade(stores: RepositoryStores): RepositoryFacade;

export function createRepositoryFacade(
  input: HistoryFacadeConfig | HistoryStore | RepositoryStores,
): RepositoryFacade {
  // Check if input is new HistoryFacadeConfig
  if ("history" in input && "backend" in input.history) {
    return createRepositoryFacadeFromHistory(input.history);
  }

  // Check if input is legacy HistoryStore
  if ("objects" in input && "backend" in input) {
    const historyStore = input as HistoryStore;
    if (!historyStore.backend) {
      throw new Error(
        "HistoryStore must have a backend for transport operations. " +
          "Use createGitRepository() to create a repository with a backend.",
      );
    }
    return createRepositoryFacadeLegacy({
      commits: historyStore.commits,
      tags: historyStore.tags,
      refs: historyStore.refs,
      serialization: historyStore.backend.serialization,
    });
  }

  // Otherwise it's RepositoryStores
  return createRepositoryFacadeLegacy(input as RepositoryStores);
}

/**
 * Create RepositoryFacade using new History interface (recommended)
 */
function createRepositoryFacadeFromHistory(history: HistoryWithBackend): RepositoryFacade {
  const { commits, tags, refs, backend } = history;
  const serialization = backend.serialization;

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
      // Use History.collectReachableObjects for efficient traversal
      const objectIds = history.collectReachableObjects(wants, exclude);
      yield* serialization.createPack(objectIds);
    },

    // ─────────────────────────────────────────────────────────────────
    // Object existence - check across all stores
    // ─────────────────────────────────────────────────────────────────

    async has(oid: string): Promise<boolean> {
      if (await commits.has(oid)) return true;
      if (await history.trees.has(oid)) return true;
      if (await history.blobs.has(oid)) return true;
      if (await tags.has(oid)) return true;
      return false;
    },

    // ─────────────────────────────────────────────────────────────────
    // Commit ancestry - walk commit graph
    // ─────────────────────────────────────────────────────────────────

    async *walkAncestors(startOid: string): AsyncGenerator<string> {
      yield* commits.walkAncestry(startOid);
    },

    // ─────────────────────────────────────────────────────────────────
    // Optional Protocol V2 methods
    // ─────────────────────────────────────────────────────────────────

    async peelTag(oid: string): Promise<string | null> {
      return (await tags.getTarget(oid)) ?? null;
    },

    async getObjectSize(oid: string): Promise<number | null> {
      // Try blobs first - most efficient with size() method
      const blobSize = await history.blobs.size(oid);
      if (blobSize >= 0) return blobSize;

      // For other types, would need to serialize to determine size
      // Return null for now as this is an optional optimization
      return null;
    },

    // ─────────────────────────────────────────────────────────────────
    // Server-side validation methods
    // ─────────────────────────────────────────────────────────────────

    async isReachableFrom(oid: string, from: string | string[]): Promise<boolean> {
      const roots = Array.isArray(from) ? from : [from];

      for (const root of roots) {
        if (await commits.isAncestor(oid, root)) {
          return true;
        }
      }

      return false;
    },

    async isReachableFromAnyTip(oid: string): Promise<boolean> {
      const tips: string[] = [];
      for await (const ref of refs.list()) {
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
 * Legacy implementation using old store interfaces
 * @deprecated Use createRepositoryFacadeFromHistory instead
 */
function createRepositoryFacadeLegacy(stores: RepositoryStores): RepositoryFacade {
  const { commits, tags, refs, serialization, objects } = stores;

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
      const objectIds = collectReachableObjectsLegacy(wants, exclude, commits);
      yield* serialization.createPack(objectIds);
    },

    // ─────────────────────────────────────────────────────────────────
    // Object existence - check commits (limited without objects store)
    // ─────────────────────────────────────────────────────────────────

    async has(oid: string): Promise<boolean> {
      if (objects) {
        return objects.has(oid);
      }
      // Fallback: check commits only
      try {
        await commits.loadCommit(oid);
        return true;
      } catch {
        return false;
      }
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
      if (objects?.getHeader) {
        try {
          const header = await objects.getHeader(oid);
          return header.size;
        } catch {
          return null;
        }
      }
      return null;
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
 * Legacy implementation using CommitStore interface.
 *
 * Uses BFS to walk the commit graph and collect all reachable commits.
 * Note: This only traverses commits, not trees or blobs.
 *
 * @deprecated Use History.collectReachableObjects() instead
 */
async function* collectReachableObjectsLegacy(
  wants: Set<string>,
  exclude: Set<string>,
  commits: CommitStore,
): AsyncGenerator<ObjectId> {
  const visited = new Set<string>();

  // Expand exclude set to include all ancestors
  const excludeExpanded = new Set<string>(exclude);
  for (const excludeOid of exclude) {
    try {
      const commit = await commits.loadCommit(excludeOid);
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

    yield oid;

    // Try to load as commit and walk its tree and parents
    try {
      const commit = await commits.loadCommit(oid);

      // Add tree to queue
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
      // For simplicity, just yield the object ID
    }
  }
}
