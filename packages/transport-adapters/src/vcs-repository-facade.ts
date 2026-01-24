/**
 * VcsRepositoryFacade
 *
 * Implements RepositoryFacade using high-level VCS stores (BlobStore, TreeStore,
 * CommitStore, TagStore, RefStore) without requiring GitObjectStore.
 *
 * This enables transport operations using only domain-level stores, similar to
 * how VcsRepositoryAccess works for the lower-level RepositoryAccess interface.
 */

import type {
  BlobStore,
  CommitStore,
  ObjectId,
  RefStore,
  SerializationApi,
  TagStore,
  TreeStore,
} from "@statewalker/vcs-core";
import { isSymbolicRef, serializeTree } from "@statewalker/vcs-core";
import type {
  ExportPackOptions,
  PackImportResult,
  RepositoryFacade,
} from "@statewalker/vcs-transport";
import { toArray } from "@statewalker/vcs-utils/streams";

/**
 * Parameters for VcsRepositoryFacade.
 * All stores are mandatory.
 */
export interface VcsRepositoryFacadeParams {
  blobs: BlobStore;
  trees: TreeStore;
  commits: CommitStore;
  tags: TagStore;
  refs: RefStore;
  serialization: SerializationApi;
}

/**
 * Repository facade implementation using high-level VCS stores.
 *
 * Provides transport-friendly operations (importPack, exportPack, has, walkAncestors)
 * using domain-level stores rather than GitObjectStore.
 */
export class VcsRepositoryFacade implements RepositoryFacade {
  constructor(private readonly stores: VcsRepositoryFacadeParams) {}

  /**
   * Import a pack stream into the repository.
   * Delegates to SerializationApi.importPack.
   */
  async importPack(packStream: AsyncIterable<Uint8Array>): Promise<PackImportResult> {
    return this.stores.serialization.importPack(packStream);
  }

  /**
   * Export objects as a pack stream.
   * Collects reachable objects from wants, excluding those in exclude set.
   */
  async *exportPack(
    wants: Set<string>,
    exclude: Set<string>,
    _options?: ExportPackOptions,
  ): AsyncIterable<Uint8Array> {
    const objectIds = this.collectReachableObjects(wants, exclude);
    yield* this.stores.serialization.createPack(objectIds);
  }

  /**
   * Check if an object exists in any store.
   * Checks in order: commits → trees → blobs → tags
   */
  async has(oid: string): Promise<boolean> {
    const { commits, trees, blobs, tags } = this.stores;

    if (await commits.has(oid)) return true;
    if (await trees.has(oid)) return true;
    if (await blobs.has(oid)) return true;
    if (await tags.has(oid)) return true;

    return false;
  }

  /**
   * Walk commit ancestry from a starting point.
   * Yields commit OIDs in BFS order.
   */
  async *walkAncestors(startOid: string): AsyncGenerator<string> {
    const { commits } = this.stores;
    const visited = new Set<string>();
    const queue: string[] = [startOid];

    while (queue.length > 0) {
      const oid = queue.shift();
      if (!oid || visited.has(oid)) continue;
      visited.add(oid);

      try {
        const commit = await commits.loadCommit(oid);
        yield oid;

        // Queue parents for BFS traversal
        for (const parentOid of commit.parents) {
          if (!visited.has(parentOid)) {
            queue.push(parentOid);
          }
        }
      } catch {
        // Not a commit - skip
      }
    }
  }

  /**
   * Peel a tag to its underlying object.
   */
  async peelTag(oid: string): Promise<string | null> {
    try {
      const tag = await this.stores.tags.loadTag(oid);
      return tag.object;
    } catch {
      return null;
    }
  }

  /**
   * Get the size of an object.
   */
  async getObjectSize(oid: string): Promise<number | null> {
    const { commits, trees, blobs, tags } = this.stores;

    // Try blobs first - most efficient with size() method
    try {
      return await blobs.size(oid);
    } catch {
      // Not a blob
    }

    // Try commits
    try {
      const commit = await commits.loadCommit(oid);
      const { serializeCommit } = await import("@statewalker/vcs-core");
      const content = serializeCommit(commit);
      return content.length;
    } catch {
      // Not a commit
    }

    // Try trees
    try {
      const entries = await toArray(trees.loadTree(oid));
      const content = serializeTree(entries);
      return content.length;
    } catch {
      // Not a tree
    }

    // Try tags
    try {
      const tag = await tags.loadTag(oid);
      const { serializeTag } = await import("@statewalker/vcs-core");
      const content = serializeTag(tag);
      return content.length;
    } catch {
      // Not found
    }

    return null;
  }

  /**
   * Check if an object is reachable from other objects.
   */
  async isReachableFrom(oid: string, from: string | string[]): Promise<boolean> {
    const roots = Array.isArray(from) ? from : [from];

    for (const root of roots) {
      for await (const ancestorOid of this.walkAncestors(root)) {
        if (ancestorOid === oid) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if an object is reachable from any ref tip.
   */
  async isReachableFromAnyTip(oid: string): Promise<boolean> {
    const { refs } = this.stores;
    const tips: string[] = [];

    for await (const ref of refs.list()) {
      const resolved = isSymbolicRef(ref) ? await refs.resolve(ref.name) : ref;
      if (resolved && "objectId" in resolved && resolved.objectId !== undefined) {
        tips.push(resolved.objectId);
      }
    }

    return this.isReachableFrom(oid, tips);
  }

  /**
   * Compute shallow boundaries for depth-limited clone.
   */
  async computeShallowBoundaries(wants: Set<string>, depth: number): Promise<Set<string>> {
    const { commits } = this.stores;
    const boundaries = new Set<string>();

    for (const want of wants) {
      const queue: Array<{ oid: string; depth: number }> = [{ oid: want, depth: 0 }];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) continue;

        const { oid, depth: d } = item;
        if (visited.has(oid)) continue;
        visited.add(oid);

        if (d >= depth) {
          boundaries.add(oid);
          continue;
        }

        try {
          const commit = await commits.loadCommit(oid);
          for (const parent of commit.parents) {
            queue.push({ oid: parent, depth: d + 1 });
          }
        } catch {
          // Not a commit - skip
        }
      }
    }

    return boundaries;
  }

  /**
   * Compute shallow boundaries since a timestamp.
   */
  async computeShallowSince(wants: Set<string>, timestamp: number): Promise<Set<string>> {
    const { commits } = this.stores;
    const boundaries = new Set<string>();

    for (const want of wants) {
      const queue: string[] = [want];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const oid = queue.shift();
        if (!oid || visited.has(oid)) continue;
        visited.add(oid);

        try {
          const commit = await commits.loadCommit(oid);

          // Check if commit is before timestamp
          if (commit.committer.timestamp < timestamp) {
            boundaries.add(oid);
            continue;
          }

          // Continue walking parents
          for (const parent of commit.parents) {
            queue.push(parent);
          }
        } catch {
          // Not a commit - skip
        }
      }
    }

    return boundaries;
  }

  /**
   * Compute shallow boundaries excluding refs.
   */
  async computeShallowExclude(wants: Set<string>, excludeRefs: string[]): Promise<Set<string>> {
    const { refs, commits } = this.stores;
    const boundaries = new Set<string>();

    // Resolve exclude refs to OIDs
    const excludeOids = new Set<string>();
    for (const refName of excludeRefs) {
      const ref = await refs.resolve(refName);
      if (ref && "objectId" in ref && ref.objectId) {
        excludeOids.add(ref.objectId);

        // Also add all ancestors of excluded refs
        for await (const ancestorOid of this.walkAncestors(ref.objectId)) {
          excludeOids.add(ancestorOid);
        }
      }
    }

    // Walk from wants and mark boundaries where we hit excluded commits
    for (const want of wants) {
      const queue: string[] = [want];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const oid = queue.shift();
        if (!oid || visited.has(oid)) continue;
        visited.add(oid);

        if (excludeOids.has(oid)) {
          boundaries.add(oid);
          continue;
        }

        try {
          const commit = await commits.loadCommit(oid);
          for (const parent of commit.parents) {
            queue.push(parent);
          }
        } catch {
          // Not a commit - skip
        }
      }
    }

    return boundaries;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Collect object IDs reachable from wants, excluding common base.
   */
  private async *collectReachableObjects(
    wants: Set<string>,
    exclude: Set<string>,
  ): AsyncGenerator<ObjectId> {
    const { commits, trees, tags } = this.stores;
    const visited = new Set<string>();

    // Expand exclude set to include all ancestors
    const excludeExpanded = new Set<string>(exclude);
    for (const excludeOid of exclude) {
      for await (const ancestorOid of this.walkAncestors(excludeOid)) {
        excludeExpanded.add(ancestorOid);
      }
    }

    // BFS from wants
    const queue: string[] = [...wants];

    while (queue.length > 0) {
      const oid = queue.shift();
      if (!oid) continue;

      if (visited.has(oid) || excludeExpanded.has(oid)) {
        continue;
      }
      visited.add(oid);

      // Check if object exists in any store
      const exists = await this.has(oid);
      if (!exists) continue;

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
        continue;
      } catch {
        // Not a commit
      }

      // Try to load as tree and walk entries
      try {
        const entries = await toArray(trees.loadTree(oid));
        for (const entry of entries) {
          if (!visited.has(entry.id)) {
            queue.push(entry.id);
          }
        }
        continue;
      } catch {
        // Not a tree
      }

      // Try to load as tag and walk tagged object
      try {
        const tag = await tags.loadTag(oid);
        if (!visited.has(tag.object)) {
          queue.push(tag.object);
        }
      } catch {
        // Not a tag
      }

      // Blob - no children to walk
    }
  }
}

/**
 * Create RepositoryFacade from VCS stores.
 *
 * @param stores - All required VCS stores plus SerializationApi
 * @returns RepositoryFacade interface for transport operations
 */
export function createVcsRepositoryFacade(stores: VcsRepositoryFacadeParams): RepositoryFacade {
  return new VcsRepositoryFacade(stores);
}
