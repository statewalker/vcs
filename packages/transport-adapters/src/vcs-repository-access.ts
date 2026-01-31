/**
 * VCS Repository Access
 *
 * Implements RepositoryAccess using the History facade for object access.
 * Provides low-level byte-level operations for protocol handlers.
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
  TagStore,
  Tags,
  TreeStore,
  Trees,
} from "@statewalker/vcs-core";
import {
  isSymbolicRef,
  ObjectType,
  parseCommit,
  parseTag,
  parseTreeToArray,
  serializeCommit,
  serializeTag,
  serializeTree,
} from "@statewalker/vcs-core";
import type {
  HeadInfo,
  ObjectInfo,
  ObjectTypeCode,
  RefInfo,
  RepositoryAccess,
} from "@statewalker/vcs-transport";
import { collect, toArray } from "@statewalker/vcs-utils/streams";
import { createGitWireFormat } from "./wire-format-utils.js";

/**
 * Configuration for VcsRepositoryAccess using History facade (recommended)
 */
export interface VcsRepositoryAccessConfig {
  /** History facade for object access */
  history: History;
}

/**
 * Legacy parameters for VcsRepositoryAccess using individual stores
 * @deprecated Use VcsRepositoryAccessConfig with History instead
 */
export interface VcsRepositoryAccessParams {
  blobs: BlobStore;
  trees: TreeStore;
  commits: CommitStore;
  tags: TagStore;
  refs: RefStore;
}

/**
 * Repository access implementation supporting both History and legacy stores.
 *
 * When using History:
 * - Uses new interface methods (load/store vs loadCommit/storeCommit)
 *
 * When using legacy stores:
 * - Uses old interface methods for backward compatibility
 */
export class VcsRepositoryAccess implements RepositoryAccess {
  // New interface accessors (work with both modes)
  private readonly _blobs: Blobs;
  private readonly _trees: Trees;
  private readonly _commits: Commits;
  private readonly _tags: Tags;
  private readonly _refs: Refs;

  constructor(config: VcsRepositoryAccessConfig);
  /** @deprecated Use VcsRepositoryAccessConfig with History instead */
  constructor(stores: VcsRepositoryAccessParams);
  constructor(configOrStores: VcsRepositoryAccessConfig | VcsRepositoryAccessParams) {
    if ("history" in configOrStores) {
      // New History-based configuration
      const { history } = configOrStores;
      this._blobs = history.blobs;
      this._trees = history.trees;
      this._commits = history.commits;
      this._tags = history.tags;
      this._refs = history.refs;
    } else {
      // Legacy stores-based configuration - wrap with adapters
      this._blobs = new BlobsAdapter(configOrStores.blobs);
      this._trees = new TreesAdapter(configOrStores.trees);
      this._commits = new CommitsAdapter(configOrStores.commits);
      this._tags = new TagsAdapter(configOrStores.tags);
      this._refs = new RefsAdapter(configOrStores.refs);
    }
  }

  /**
   * Check if an object exists in any store.
   * Checks in order: commits → trees → blobs → tags
   */
  async hasObject(id: ObjectId): Promise<boolean> {
    if (await this._commits.has(id)) return true;
    if (await this._trees.has(id)) return true;
    if (await this._blobs.has(id)) return true;
    if (await this._tags.has(id)) return true;

    return false;
  }

  /**
   * Get object type and size.
   *
   * For blobs, uses efficient size() method.
   * For other types, serializes to determine size.
   */
  async getObjectInfo(id: ObjectId): Promise<ObjectInfo | null> {
    // Try commits first
    const commit = await this._commits.load(id);
    if (commit) {
      const serialized = serializeCommit(commit);
      return { type: ObjectType.COMMIT, size: serialized.length };
    }

    // Try trees
    const tree = await this._trees.load(id);
    if (tree) {
      const entries = await toArray(tree);
      const serialized = serializeTree(entries);
      return { type: ObjectType.TREE, size: serialized.length };
    }

    // Try tags before blobs (tags have more structure)
    const tag = await this._tags.load(id);
    if (tag) {
      const serialized = serializeTag(tag);
      return { type: ObjectType.TAG, size: serialized.length };
    }

    // Try blobs - use efficient size() method
    const blobSize = await this._blobs.size(id);
    if (blobSize >= 0) {
      return { type: ObjectType.BLOB, size: blobSize };
    }

    return null;
  }

  /**
   * Load object content in Git wire format.
   *
   * Serializes domain objects and prepends Git header.
   */
  async *loadObject(id: ObjectId): AsyncIterable<Uint8Array> {
    // Try commits first
    const commit = await this._commits.load(id);
    if (commit) {
      const content = serializeCommit(commit);
      yield createGitWireFormat("commit", content);
      return;
    }

    // Try trees
    const tree = await this._trees.load(id);
    if (tree) {
      const entries = await toArray(tree);
      const content = serializeTree(entries);
      yield createGitWireFormat("tree", content);
      return;
    }

    // Try tags before blobs (tags have more structure)
    const tag = await this._tags.load(id);
    if (tag) {
      const content = serializeTag(tag);
      yield createGitWireFormat("tag", content);
      return;
    }

    // Try blobs
    try {
      const blob = await this._blobs.load(id);
      if (blob) {
        const content = await collect(blob);
        yield createGitWireFormat("blob", content);
        return;
      }
    } catch {
      // Not a blob
    }

    throw new Error(`Object not found: ${id}`);
  }

  /**
   * Store an object.
   *
   * Parses wire content and stores in appropriate high-level store.
   */
  async storeObject(type: ObjectTypeCode, content: Uint8Array): Promise<ObjectId> {
    switch (type) {
      case ObjectType.COMMIT: {
        const commit = parseCommit(content);
        return this._commits.store(commit);
      }

      case ObjectType.TREE: {
        const entries = parseTreeToArray(content);
        return this._trees.store(entries);
      }

      case ObjectType.BLOB: {
        return this._blobs.store([content]);
      }

      case ObjectType.TAG: {
        const tag = parseTag(content);
        return this._tags.store(tag);
      }

      default:
        throw new Error(`Unknown object type: ${type}`);
    }
  }

  /**
   * List all refs in the repository.
   *
   * Resolves symbolic refs to get objectIds.
   */
  async *listRefs(): AsyncIterable<RefInfo> {
    for await (const ref of this._refs.list()) {
      if (isSymbolicRef(ref)) {
        // Resolve symbolic ref to get objectId
        const resolved = await this._refs.resolve(ref.name);
        if (resolved?.objectId) {
          yield {
            name: ref.name,
            objectId: resolved.objectId,
          };
        }
      } else if (ref.objectId) {
        const refInfo: RefInfo = {
          name: ref.name,
          objectId: ref.objectId,
        };

        // Include peeledId for annotated tags
        if (ref.peeledObjectId) {
          refInfo.peeledId = ref.peeledObjectId;
        } else if (ref.name.startsWith("refs/tags/") && (await this._tags.has(ref.objectId))) {
          // If it's a tag ref pointing to a tag object, try to get peeled target
          const peeled = await this._tags.getTarget(ref.objectId, true);
          if (peeled && peeled !== ref.objectId) {
            refInfo.peeledId = peeled;
          }
        }

        yield refInfo;
      }
    }
  }

  /**
   * Get HEAD reference (may be symbolic).
   */
  async getHead(): Promise<HeadInfo | null> {
    const head = await this._refs.get("HEAD");
    if (!head) return null;

    if (isSymbolicRef(head)) {
      return { target: head.target };
    }

    return { objectId: head.objectId };
  }

  /**
   * Update a ref.
   *
   * Uses compareAndSwap for atomic updates when oldId is provided.
   */
  async updateRef(name: string, oldId: ObjectId | null, newId: ObjectId | null): Promise<boolean> {
    if (newId === null) {
      // Delete ref
      return this._refs.remove(name);
    }

    if (oldId !== null) {
      // Compare-and-swap update
      const result = await this._refs.compareAndSwap(name, oldId, newId);
      return result.success;
    }

    // Simple set (create or overwrite)
    await this._refs.set(name, newId);
    return true;
  }

  /**
   * Walk object graph from starting points.
   *
   * Collects all objects reachable from wants, excluding haves.
   */
  async *walkObjects(
    wants: ObjectId[],
    haves: ObjectId[],
  ): AsyncIterable<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
    const haveSet = new Set(haves);
    const seen = new Set<ObjectId>();

    for (const wantId of wants) {
      yield* this.walkObject(wantId, haveSet, seen);
    }
  }

  /**
   * Recursively walk an object and its references.
   */
  private async *walkObject(
    id: ObjectId,
    haveSet: Set<ObjectId>,
    seen: Set<ObjectId>,
  ): AsyncGenerator<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
    if (seen.has(id) || haveSet.has(id)) return;
    seen.add(id);

    // Try commits first
    const commit = await this._commits.load(id);
    if (commit) {
      const content = serializeCommit(commit);
      yield { id, type: ObjectType.COMMIT, content };

      // Walk tree
      yield* this.walkObject(commit.tree, haveSet, seen);

      // Walk parent commits
      for (const parentId of commit.parents) {
        yield* this.walkObject(parentId, haveSet, seen);
      }
      return;
    }

    // Try trees
    const tree = await this._trees.load(id);
    if (tree) {
      const entries = await toArray(tree);
      const content = serializeTree(entries);
      yield { id, type: ObjectType.TREE, content };

      // Walk tree entries
      for (const entry of entries) {
        yield* this.walkObject(entry.id, haveSet, seen);
      }
      return;
    }

    // Try tags before blobs (tags have more structure)
    const tag = await this._tags.load(id);
    if (tag) {
      const content = serializeTag(tag);
      yield { id, type: ObjectType.TAG, content };

      // Walk tagged object
      yield* this.walkObject(tag.object, haveSet, seen);
      return;
    }

    // Try blobs (catch-all for non-structured objects)
    try {
      const blob = await this._blobs.load(id);
      if (blob) {
        const content = await collect(blob);
        yield { id, type: ObjectType.BLOB, content };
        return;
      }
    } catch {
      // Not a blob - skip
    }

    // Object not found - skip silently (might be unreachable)
  }
}

/**
 * Create RepositoryAccess from History facade (recommended).
 *
 * @param config - History facade configuration
 * @returns RepositoryAccess interface for protocol handlers
 */
export function createVcsRepositoryAccess(config: VcsRepositoryAccessConfig): RepositoryAccess;

/**
 * Create RepositoryAccess from VCS stores (deprecated).
 *
 * @deprecated Use VcsRepositoryAccessConfig with History instead
 * @param stores - All required VCS stores
 * @returns RepositoryAccess interface for protocol handlers
 */
export function createVcsRepositoryAccess(stores: VcsRepositoryAccessParams): RepositoryAccess;

export function createVcsRepositoryAccess(
  configOrStores: VcsRepositoryAccessConfig | VcsRepositoryAccessParams,
): RepositoryAccess {
  return new VcsRepositoryAccess(configOrStores as VcsRepositoryAccessConfig);
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Adapters - Wrap old store interfaces to new interfaces
// ─────────────────────────────────────────────────────────────────────────────

import type { BlobContent, Commit, Tag, TreeEntry } from "@statewalker/vcs-core";

/** @internal Adapter from BlobStore to Blobs */
class BlobsAdapter implements Blobs {
  constructor(private readonly blobStore: BlobStore) {}

  async store(content: BlobContent | Iterable<Uint8Array>): Promise<ObjectId> {
    if (Symbol.asyncIterator in content) {
      return this.blobStore.store(content as AsyncIterable<Uint8Array>);
    }
    return this.blobStore.store(iterableToAsync(content as Iterable<Uint8Array>));
  }

  async load(id: ObjectId): Promise<BlobContent | undefined> {
    // Need try-catch because blobStore.has() may return true for non-blob objects
    // when stores share a common backend (GitObjectStore)
    try {
      if (!(await this.blobStore.has(id))) return undefined;
      return this.blobStore.load(id);
    } catch {
      return undefined;
    }
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
class TreesAdapter implements Trees {
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
class CommitsAdapter implements Commits {
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
class TagsAdapter implements Tags {
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
class RefsAdapter implements Refs {
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
