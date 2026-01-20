/**
 * VCS Repository Access
 *
 * Implements RepositoryAccess using high-level VCS stores (BlobStore, TreeStore,
 * CommitStore, TagStore, RefStore) instead of GitObjectStore. This eliminates
 * the tight coupling to Git wire format at the adapter layer.
 */

import type {
  BlobStore,
  CommitStore,
  ObjectId,
  RefStore,
  TagStore,
  TreeStore,
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
 * Parameters for VcsRepositoryAccess.
 * All stores are mandatory.
 */
export interface VcsRepositoryAccessParams {
  blobs: BlobStore;
  trees: TreeStore;
  commits: CommitStore;
  tags: TagStore;
  refs: RefStore;
}

/**
 * Repository access implementation using high-level VCS stores.
 *
 * Uses domain-level stores directly without GitObjectStore intermediary.
 */
export class VcsRepositoryAccess implements RepositoryAccess {
  constructor(private readonly stores: VcsRepositoryAccessParams) {}

  /**
   * Check if an object exists in any store.
   * Checks in order: commits → trees → blobs → tags
   */
  async hasObject(id: ObjectId): Promise<boolean> {
    const { commits, trees, blobs, tags } = this.stores;

    if (await commits.has(id)) return true;
    if (await trees.has(id)) return true;
    if (await blobs.has(id)) return true;
    if (await tags.has(id)) return true;

    return false;
  }

  /**
   * Get object type and size.
   *
   * For blobs, uses efficient size() method.
   * For other types, serializes to determine size.
   *
   * Note: Uses try-catch to handle stores that share a common backend,
   * where has() returns true regardless of type.
   */
  async getObjectInfo(id: ObjectId): Promise<ObjectInfo | null> {
    const { commits, trees, blobs, tags } = this.stores;

    // Try commits first
    try {
      const commit = await commits.loadCommit(id);
      const serialized = serializeCommit(commit);
      return { type: ObjectType.COMMIT, size: serialized.length };
    } catch {
      // Not a commit, try next type
    }

    // Try trees
    try {
      const entries = await toArray(trees.loadTree(id));
      const serialized = serializeTree(entries);
      return { type: ObjectType.TREE, size: serialized.length };
    } catch {
      // Not a tree, try next type
    }

    // Try blobs - use efficient size() method
    try {
      const size = await blobs.size(id);
      return { type: ObjectType.BLOB, size };
    } catch {
      // Not a blob, try next type
    }

    // Try tags
    try {
      const tag = await tags.loadTag(id);
      const serialized = serializeTag(tag);
      return { type: ObjectType.TAG, size: serialized.length };
    } catch {
      // Not found
    }

    return null;
  }

  /**
   * Load object content in Git wire format.
   *
   * Serializes domain objects and prepends Git header.
   *
   * Note: Uses try-catch to handle stores that share a common backend,
   * where has() returns true regardless of type.
   */
  async *loadObject(id: ObjectId): AsyncIterable<Uint8Array> {
    const { commits, trees, blobs, tags } = this.stores;

    // Try commits first
    try {
      const commit = await commits.loadCommit(id);
      const content = serializeCommit(commit);
      yield createGitWireFormat("commit", content);
      return;
    } catch {
      // Not a commit, try next type
    }

    // Try trees
    try {
      const entries = await toArray(trees.loadTree(id));
      const content = serializeTree(entries);
      yield createGitWireFormat("tree", content);
      return;
    } catch {
      // Not a tree, try next type
    }

    // Try blobs
    try {
      const content = await collect(blobs.load(id));
      yield createGitWireFormat("blob", content);
      return;
    } catch {
      // Not a blob, try next type
    }

    // Try tags
    try {
      const tag = await tags.loadTag(id);
      const content = serializeTag(tag);
      yield createGitWireFormat("tag", content);
      return;
    } catch {
      // Not found
    }

    throw new Error(`Object not found: ${id}`);
  }

  /**
   * Store an object.
   *
   * Parses wire content and stores in appropriate high-level store.
   */
  async storeObject(type: ObjectTypeCode, content: Uint8Array): Promise<ObjectId> {
    const { commits, trees, blobs, tags } = this.stores;

    switch (type) {
      case ObjectType.COMMIT: {
        const commit = parseCommit(content);
        return commits.storeCommit(commit);
      }

      case ObjectType.TREE: {
        const entries = parseTreeToArray(content);
        return trees.storeTree(entries);
      }

      case ObjectType.BLOB: {
        return blobs.store([content]);
      }

      case ObjectType.TAG: {
        const tag = parseTag(content);
        return tags.storeTag(tag);
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
    const { refs, tags } = this.stores;

    for await (const ref of refs.list()) {
      if (isSymbolicRef(ref)) {
        // Resolve symbolic ref to get objectId
        const resolved = await refs.resolve(ref.name);
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
        } else if (ref.name.startsWith("refs/tags/") && (await tags.has(ref.objectId))) {
          // If it's a tag ref pointing to a tag object, try to get peeled target
          try {
            const peeled = await tags.getTarget(ref.objectId, true);
            if (peeled !== ref.objectId) {
              refInfo.peeledId = peeled;
            }
          } catch {
            // Ignore errors getting peeled target
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
    const head = await this.stores.refs.get("HEAD");
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
    const { refs } = this.stores;

    if (newId === null) {
      // Delete ref
      return refs.delete(name);
    }

    if (oldId !== null) {
      // Compare-and-swap update
      const result = await refs.compareAndSwap(name, oldId, newId);
      return result.success;
    }

    // Simple set (create or overwrite)
    await refs.set(name, newId);
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
   *
   * Note: Uses try-catch to handle stores that share a common backend,
   * where has() returns true regardless of type.
   */
  private async *walkObject(
    id: ObjectId,
    haveSet: Set<ObjectId>,
    seen: Set<ObjectId>,
  ): AsyncGenerator<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
    if (seen.has(id) || haveSet.has(id)) return;
    seen.add(id);

    const { commits, trees, blobs, tags } = this.stores;

    // Try commits first
    try {
      const commit = await commits.loadCommit(id);
      const content = serializeCommit(commit);
      yield { id, type: ObjectType.COMMIT, content };

      // Walk tree
      yield* this.walkObject(commit.tree, haveSet, seen);

      // Walk parent commits
      for (const parentId of commit.parents) {
        yield* this.walkObject(parentId, haveSet, seen);
      }
      return;
    } catch {
      // Not a commit, try next type
    }

    // Try trees
    try {
      const entries = await toArray(trees.loadTree(id));
      const content = serializeTree(entries);
      yield { id, type: ObjectType.TREE, content };

      // Walk tree entries
      for (const entry of entries) {
        yield* this.walkObject(entry.id, haveSet, seen);
      }
      return;
    } catch {
      // Not a tree, try next type
    }

    // Try blobs
    try {
      const content = await collect(blobs.load(id));
      yield { id, type: ObjectType.BLOB, content };
      return;
    } catch {
      // Not a blob, try next type
    }

    // Try tags
    try {
      const tag = await tags.loadTag(id);
      const content = serializeTag(tag);
      yield { id, type: ObjectType.TAG, content };

      // Walk tagged object
      yield* this.walkObject(tag.object, haveSet, seen);
      return;
    } catch {
      // Not found
    }

    // Object not found - skip silently (might be unreachable)
  }
}

/**
 * Create RepositoryAccess from VCS stores.
 *
 * @param stores - All required VCS stores
 * @returns RepositoryAccess interface for protocol handlers
 */
export function createVcsRepositoryAccess(stores: VcsRepositoryAccessParams): RepositoryAccess {
  return new VcsRepositoryAccess(stores);
}
