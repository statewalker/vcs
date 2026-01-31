/**
 * VcsRepositoryFacade
 *
 * Implements RepositoryFacade using the History facade for object access.
 * Delegates to History.collectReachableObjects() for pack export and
 * SerializationApi for pack import/creation.
 *
 * Supports both:
 * - New History-based API (recommended)
 * - Legacy store-based API (deprecated, for backward compatibility)
 */

import type {
  BlobStore,
  Blobs,
  CommitStore,
  Commits,
  History,
  ObjectId,
  RefStore,
  Refs,
  SerializationApi,
  TagStore,
  Tags,
  TreeStore,
  Trees,
} from "@statewalker/vcs-core";
import { isSymbolicRef, serializeTree } from "@statewalker/vcs-core";
import type {
  ExportPackOptions,
  PackImportResult,
  RepositoryFacade,
} from "@statewalker/vcs-transport";
import { toArray } from "@statewalker/vcs-utils/streams";

/**
 * Configuration for VcsRepositoryFacade using History facade (recommended)
 */
export interface VcsRepositoryFacadeConfig {
  /** History facade for object access */
  history: History;
  /** Serialization API for pack operations */
  serialization: SerializationApi;
}

/**
 * Legacy parameters for VcsRepositoryFacade using individual stores
 * @deprecated Use VcsRepositoryFacadeConfig with History instead
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
 * Repository facade implementation supporting both History and legacy stores.
 *
 * When using History:
 * - Delegates collectReachableObjects() to History
 * - Uses new interface methods (load/store vs loadCommit/storeCommit)
 *
 * When using legacy stores:
 * - Implements collectReachableObjects() internally
 * - Uses old interface methods for backward compatibility
 */
export class VcsRepositoryFacade implements RepositoryFacade {
  private readonly _history?: History;
  private readonly _serialization: SerializationApi;

  // New interface accessors (work with both modes)
  private readonly _blobs: Blobs;
  private readonly _trees: Trees;
  private readonly _commits: Commits;
  private readonly _tags: Tags;
  private readonly _refs: Refs;

  constructor(config: VcsRepositoryFacadeConfig);
  /** @deprecated Use VcsRepositoryFacadeConfig with History instead */
  constructor(stores: VcsRepositoryFacadeParams);
  constructor(configOrStores: VcsRepositoryFacadeConfig | VcsRepositoryFacadeParams) {
    if ("history" in configOrStores) {
      // New History-based configuration
      this._history = configOrStores.history;
      this._serialization = configOrStores.serialization;

      // Use History's stores directly
      this._blobs = this._history.blobs;
      this._trees = this._history.trees;
      this._commits = this._history.commits;
      this._tags = this._history.tags;
      this._refs = this._history.refs;
    } else {
      // Legacy stores-based configuration
      this._serialization = configOrStores.serialization;

      // Create adapters from legacy stores to new interfaces
      this._blobs = new BlobsLegacyAdapter(configOrStores.blobs);
      this._trees = new TreesLegacyAdapter(configOrStores.trees);
      this._commits = new CommitsLegacyAdapter(configOrStores.commits);
      this._tags = new TagsLegacyAdapter(configOrStores.tags);
      this._refs = new RefsLegacyAdapter(configOrStores.refs);
    }
  }

  /**
   * Import a pack stream into the repository.
   * Delegates to SerializationApi.importPack.
   */
  async importPack(packStream: AsyncIterable<Uint8Array>): Promise<PackImportResult> {
    return this._serialization.importPack(packStream);
  }

  /**
   * Export objects as a pack stream.
   * Collects reachable objects from wants, excluding those in exclude set.
   *
   * When using History, delegates to History.collectReachableObjects().
   * When using legacy stores, uses internal traversal implementation.
   */
  async *exportPack(
    wants: Set<string>,
    exclude: Set<string>,
    _options?: ExportPackOptions,
  ): AsyncIterable<Uint8Array> {
    // Use History's collectReachableObjects if available
    const objectIds = this._history
      ? this._history.collectReachableObjects(wants, exclude)
      : this.collectReachableObjectsLegacy(wants, exclude);
    yield* this._serialization.createPack(objectIds);
  }

  /**
   * Check if an object exists in any store.
   * Checks in order: commits → trees → blobs → tags
   */
  async has(oid: string): Promise<boolean> {
    if (await this._commits.has(oid)) return true;
    if (await this._trees.has(oid)) return true;
    if (await this._blobs.has(oid)) return true;
    if (await this._tags.has(oid)) return true;
    return false;
  }

  /**
   * Walk commit ancestry from a starting point.
   * Yields commit OIDs in BFS order.
   */
  async *walkAncestors(startOid: string): AsyncGenerator<string> {
    const visited = new Set<string>();
    const queue: string[] = [startOid];

    while (queue.length > 0) {
      const oid = queue.shift();
      if (!oid || visited.has(oid)) continue;
      visited.add(oid);

      const commit = await this._commits.load(oid);
      if (commit) {
        yield oid;
        // Queue parents for BFS traversal
        for (const parentOid of commit.parents) {
          if (!visited.has(parentOid)) {
            queue.push(parentOid);
          }
        }
      }
    }
  }

  /**
   * Peel a tag to its underlying object.
   */
  async peelTag(oid: string): Promise<string | null> {
    return (await this._tags.getTarget(oid)) ?? null;
  }

  /**
   * Get the size of an object.
   */
  async getObjectSize(oid: string): Promise<number | null> {
    // Try blobs first - most efficient with size() method
    const blobSize = await this._blobs.size(oid);
    if (blobSize >= 0) return blobSize;

    // Try commits
    const commit = await this._commits.load(oid);
    if (commit) {
      const { serializeCommit } = await import("@statewalker/vcs-core");
      const content = serializeCommit(commit);
      return content.length;
    }

    // Try trees
    const tree = await this._trees.load(oid);
    if (tree) {
      const entries = await toArray(tree);
      const content = serializeTree(entries);
      return content.length;
    }

    // Try tags
    const tag = await this._tags.load(oid);
    if (tag) {
      const { serializeTag } = await import("@statewalker/vcs-core");
      const content = serializeTag(tag);
      return content.length;
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
    const tips: string[] = [];

    for await (const ref of this._refs.list()) {
      const resolved = isSymbolicRef(ref) ? await this._refs.resolve(ref.name) : ref;
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

        const commit = await this._commits.load(oid);
        if (commit) {
          for (const parent of commit.parents) {
            queue.push({ oid: parent, depth: d + 1 });
          }
        }
      }
    }

    return boundaries;
  }

  /**
   * Compute shallow boundaries since a timestamp.
   */
  async computeShallowSince(wants: Set<string>, timestamp: number): Promise<Set<string>> {
    const boundaries = new Set<string>();

    for (const want of wants) {
      const queue: string[] = [want];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const oid = queue.shift();
        if (!oid || visited.has(oid)) continue;
        visited.add(oid);

        const commit = await this._commits.load(oid);
        if (commit) {
          // Check if commit is before timestamp
          if (commit.committer.timestamp < timestamp) {
            boundaries.add(oid);
            continue;
          }

          // Continue walking parents
          for (const parent of commit.parents) {
            queue.push(parent);
          }
        }
      }
    }

    return boundaries;
  }

  /**
   * Compute shallow boundaries excluding refs.
   */
  async computeShallowExclude(wants: Set<string>, excludeRefs: string[]): Promise<Set<string>> {
    const boundaries = new Set<string>();

    // Resolve exclude refs to OIDs
    const excludeOids = new Set<string>();
    for (const refName of excludeRefs) {
      const ref = await this._refs.resolve(refName);
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

        const commit = await this._commits.load(oid);
        if (commit) {
          for (const parent of commit.parents) {
            queue.push(parent);
          }
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
   * This is used when History is not available (legacy mode).
   */
  private async *collectReachableObjectsLegacy(
    wants: Set<string>,
    exclude: Set<string>,
  ): AsyncGenerator<ObjectId> {
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
      const commit = await this._commits.load(oid);
      if (commit) {
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
      }

      // Try to load as tree and walk entries
      const tree = await this._trees.load(oid);
      if (tree) {
        const entries = await toArray(tree);
        for (const entry of entries) {
          if (!visited.has(entry.id)) {
            queue.push(entry.id);
          }
        }
        continue;
      }

      // Try to load as tag and walk tagged object
      const tag = await this._tags.load(oid);
      if (tag) {
        if (!visited.has(tag.object)) {
          queue.push(tag.object);
        }
      }

      // Blob - no children to walk
    }
  }
}

/**
 * Create RepositoryFacade from History facade (recommended).
 *
 * @param config - History facade and SerializationApi
 * @returns RepositoryFacade interface for transport operations
 */
export function createVcsRepositoryFacade(config: VcsRepositoryFacadeConfig): RepositoryFacade;

/**
 * Create RepositoryFacade from VCS stores (deprecated).
 *
 * @deprecated Use VcsRepositoryFacadeConfig with History instead
 * @param stores - All required VCS stores plus SerializationApi
 * @returns RepositoryFacade interface for transport operations
 */
export function createVcsRepositoryFacade(stores: VcsRepositoryFacadeParams): RepositoryFacade;

export function createVcsRepositoryFacade(
  configOrStores: VcsRepositoryFacadeConfig | VcsRepositoryFacadeParams,
): RepositoryFacade {
  return new VcsRepositoryFacade(configOrStores as VcsRepositoryFacadeConfig);
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Adapters - Wrap old store interfaces to new interfaces
// ─────────────────────────────────────────────────────────────────────────────

import type { BlobContent, Commit, Tag, TreeEntry } from "@statewalker/vcs-core";

/** @internal Adapter from BlobStore to Blobs */
class BlobsLegacyAdapter implements Blobs {
  constructor(private readonly blobStore: BlobStore) {}

  async store(content: BlobContent | Iterable<Uint8Array>): Promise<ObjectId> {
    if (Symbol.asyncIterator in content) {
      return this.blobStore.store(content as AsyncIterable<Uint8Array>);
    }
    return this.blobStore.store(iterableToAsync(content as Iterable<Uint8Array>));
  }

  async load(id: ObjectId): Promise<BlobContent | undefined> {
    if (!(await this.blobStore.has(id))) return undefined;
    return this.blobStore.load(id);
  }

  has(id: ObjectId): Promise<boolean> {
    return this.blobStore.has(id);
  }

  remove(id: ObjectId): Promise<boolean> {
    return this.blobStore.delete(id);
  }

  async *keys(): AsyncIterable<ObjectId> {
    yield* this.blobStore.keys();
  }

  async size(id: ObjectId): Promise<number> {
    try {
      return await this.blobStore.size(id);
    } catch {
      return -1;
    }
  }
}

/** @internal Adapter from TreeStore to Trees */
class TreesLegacyAdapter implements Trees {
  constructor(private readonly treeStore: TreeStore) {}

  store(tree: TreeEntry[] | AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId> {
    return this.treeStore.storeTree(tree);
  }

  async load(id: ObjectId): Promise<AsyncIterable<TreeEntry> | undefined> {
    // Must check has() first since loadTree returns a generator that defers errors
    if (!(await this.has(id))) return undefined;
    return this.treeStore.loadTree(id);
  }

  async has(id: ObjectId): Promise<boolean> {
    try {
      const tree = this.treeStore.loadTree(id);
      for await (const _ of tree) {
        break;
      }
      return true;
    } catch {
      return false;
    }
  }

  async remove(_id: ObjectId): Promise<boolean> {
    return false;
  }

  async *keys(): AsyncIterable<ObjectId> {
    // TreeStore doesn't have keys method
  }

  async getEntry(treeId: ObjectId, name: string): Promise<TreeEntry | undefined> {
    const entries = await this.load(treeId);
    if (!entries) return undefined;
    for await (const entry of entries) {
      if (entry.name === name) return entry;
    }
    return undefined;
  }

  getEmptyTreeId(): ObjectId {
    return "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  }
}

/** @internal Adapter from CommitStore to Commits */
class CommitsLegacyAdapter implements Commits {
  constructor(private readonly commitStore: CommitStore) {}

  store(commit: Commit): Promise<ObjectId> {
    return this.commitStore.storeCommit(commit);
  }

  async load(id: ObjectId): Promise<Commit | undefined> {
    try {
      return await this.commitStore.loadCommit(id);
    } catch {
      return undefined;
    }
  }

  async has(id: ObjectId): Promise<boolean> {
    try {
      await this.commitStore.loadCommit(id);
      return true;
    } catch {
      return false;
    }
  }

  async remove(_id: ObjectId): Promise<boolean> {
    return false;
  }

  async *keys(): AsyncIterable<ObjectId> {
    // CommitStore doesn't have keys method
  }

  getParents(commitId: ObjectId): Promise<ObjectId[]> {
    return this.commitStore.getParents(commitId);
  }

  getTree(commitId: ObjectId): Promise<ObjectId | undefined> {
    return this.commitStore.getTree(commitId);
  }

  walkAncestry(
    startId: ObjectId | ObjectId[],
    options?: import("@statewalker/vcs-core").AncestryOptions,
  ): AsyncIterable<ObjectId> {
    return this.commitStore.walkAncestry(startId, options);
  }

  findMergeBase(commit1: ObjectId, commit2: ObjectId): Promise<ObjectId[]> {
    return this.commitStore.findMergeBase(commit1, commit2);
  }

  isAncestor(ancestor: ObjectId, descendant: ObjectId): Promise<boolean> {
    return this.commitStore.isAncestor(ancestor, descendant);
  }
}

/** @internal Adapter from TagStore to Tags */
class TagsLegacyAdapter implements Tags {
  constructor(private readonly tagStore: TagStore) {}

  store(tag: Tag): Promise<ObjectId> {
    return this.tagStore.storeTag(tag);
  }

  async load(id: ObjectId): Promise<Tag | undefined> {
    try {
      return await this.tagStore.loadTag(id);
    } catch {
      return undefined;
    }
  }

  async has(id: ObjectId): Promise<boolean> {
    try {
      await this.tagStore.loadTag(id);
      return true;
    } catch {
      return false;
    }
  }

  async remove(_id: ObjectId): Promise<boolean> {
    return false;
  }

  async *keys(): AsyncIterable<ObjectId> {
    // TagStore doesn't have keys method
  }

  async getTarget(tagId: ObjectId, _peel?: boolean): Promise<ObjectId | undefined> {
    try {
      const tag = await this.tagStore.loadTag(tagId);
      return tag.object;
    } catch {
      return undefined;
    }
  }
}

/** @internal Adapter from RefStore to Refs */
class RefsLegacyAdapter implements Refs {
  constructor(private readonly refStore: RefStore) {}

  get(name: string): Promise<import("@statewalker/vcs-core").RefValue | undefined> {
    return this.refStore.get(name);
  }

  resolve(name: string): Promise<import("@statewalker/vcs-core").Ref | undefined> {
    return this.refStore.resolve(name);
  }

  has(name: string): Promise<boolean> {
    return this.refStore.has(name);
  }

  list(prefix?: string): AsyncIterable<import("@statewalker/vcs-core").RefEntry> {
    return this.refStore.list(prefix);
  }

  set(name: string, objectId: ObjectId): Promise<void> {
    return this.refStore.set(name, objectId);
  }

  setSymbolic(name: string, target: string): Promise<void> {
    return this.refStore.setSymbolic(name, target);
  }

  remove(name: string): Promise<boolean> {
    return this.refStore.delete(name);
  }

  compareAndSwap(
    name: string,
    expected: ObjectId | undefined,
    newValue: ObjectId,
  ): Promise<import("@statewalker/vcs-core").RefUpdateResult> {
    return this.refStore.compareAndSwap(name, expected, newValue);
  }
}

/** Helper to convert sync iterable to async */
async function* iterableToAsync(iter: Iterable<Uint8Array>): AsyncIterable<Uint8Array> {
  for (const item of iter) {
    yield item;
  }
}
