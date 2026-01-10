/**
 * VCS Repository Adapter
 *
 * Adapts VCS package interfaces (GitObjectStore, RefStore, CommitStore, TreeStore, TagStore)
 * to the RepositoryAccess interface used by HTTP protocol handlers.
 *
 * This adapter provides a clean integration layer that uses only interfaces from
 * @statewalker/vcs-core, eliminating dependencies on implementation-specific storage types.
 */

import type {
  CommitStore,
  RepositoryAccess as CoreRepositoryAccess,
  ObjectTypeCode,
  Ref,
  RefStore,
  SymbolicRef,
  TagStore,
  TreeStore,
} from "@statewalker/vcs-core";
import type {
  HeadInfo,
  ObjectId,
  ObjectInfo,
  RefInfo,
  RepositoryAccess,
} from "../handlers/types.js";

/**
 * VCS stores required for HTTP server operations.
 * Uses only interfaces from @statewalker/vcs-core package.
 */
export interface VcsStores {
  /** Repository access for object operations */
  repositoryAccess: CoreRepositoryAccess;
  /** Reference storage */
  refs: RefStore;
  /** Commit parsing/storage */
  commits: CommitStore;
  /** Tree parsing/storage */
  trees: TreeStore;
  /** Tag parsing/storage (optional) */
  tags?: TagStore;
}

/**
 * Factory function type for resolving repository using VCS stores.
 */
export type VcsRepositoryResolver = (
  request: Request,
  repoPath: string,
) => Promise<VcsStores | null>;

/**
 * Create RepositoryAccess from VCS stores.
 *
 * @param stores - VCS store implementations
 * @returns RepositoryAccess interface for protocol handlers
 */
export function createVcsRepositoryAdapter(stores: VcsStores): RepositoryAccess {
  const { repositoryAccess, refs, commits, trees, tags } = stores;

  const checkIsSymbolicRef = (ref: Ref | SymbolicRef): ref is SymbolicRef => {
    return "target" in ref && typeof ref.target === "string";
  };

  return {
    /**
     * List all refs in the repository.
     * Maps RefStore.list() to the handler's expected format.
     */
    async *listRefs(): AsyncIterable<RefInfo> {
      for await (const ref of refs.list()) {
        if (checkIsSymbolicRef(ref)) {
          // For symbolic refs, resolve to get the actual objectId
          const resolved = await refs.resolve(ref.name);
          if (resolved?.objectId) {
            yield {
              name: ref.name,
              objectId: resolved.objectId,
            };
          }
        } else if (ref.objectId) {
          yield {
            name: ref.name,
            objectId: ref.objectId,
            peeledId: ref.peeledObjectId,
          };
        }
      }
    },

    /**
     * Get HEAD reference (may be symbolic).
     */
    async getHead(): Promise<HeadInfo | null> {
      const head = await refs.get("HEAD");
      if (!head) return null;

      if (checkIsSymbolicRef(head)) {
        return { target: head.target };
      }
      return { objectId: head.objectId };
    },

    /**
     * Check if an object exists.
     */
    async hasObject(id: ObjectId): Promise<boolean> {
      return repositoryAccess.has(id);
    },

    /**
     * Get object type and size.
     */
    async getObjectInfo(id: ObjectId): Promise<ObjectInfo | null> {
      const info = await repositoryAccess.getInfo(id);
      if (!info) return null;
      return { type: info.type, size: info.size };
    },

    /**
     * Load object content (raw with header).
     */
    async *loadObject(id: ObjectId): AsyncIterable<Uint8Array> {
      const data = await repositoryAccess.loadWireFormat(id);
      if (data) yield data;
    },

    /**
     * Store an object.
     */
    async storeObject(type: ObjectTypeCode, content: Uint8Array): Promise<ObjectId> {
      return repositoryAccess.store(type, content);
    },

    /**
     * Update a ref.
     * Uses compareAndSwap for atomic updates when oldId is provided.
     */
    async updateRef(
      name: string,
      oldId: ObjectId | null,
      newId: ObjectId | null,
    ): Promise<boolean> {
      if (newId === null) {
        // Delete ref
        return refs.delete(name);
      }

      if (oldId !== null) {
        // Compare-and-swap update for atomic updates
        const result = await refs.compareAndSwap(name, oldId, newId);
        return result.success;
      }

      // Simple set (create or overwrite)
      await refs.set(name, newId);
      return true;
    },

    /**
     * Walk object graph from starting points.
     * Collects all objects reachable from wants, excluding haves.
     */
    async *walkObjects(
      wants: ObjectId[],
      haves: ObjectId[],
    ): AsyncIterable<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
      const haveSet = new Set(haves);
      const seen = new Set<ObjectId>();

      for (const wantId of wants) {
        yield* walkObject(wantId, haveSet, seen, repositoryAccess, commits, trees, tags);
      }
    },
  };
}

/**
 * Recursively walk an object and its references.
 */
async function* walkObject(
  id: ObjectId,
  haveSet: Set<ObjectId>,
  seen: Set<ObjectId>,
  repositoryAccess: CoreRepositoryAccess,
  commits: CommitStore,
  trees: TreeStore,
  tags?: TagStore,
): AsyncGenerator<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
  if (seen.has(id) || haveSet.has(id)) return;
  seen.add(id);

  const wireData = await repositoryAccess.loadWireFormat(id);
  if (!wireData) return;
  const { type, body } = parseGitObject(wireData);

  yield { id, type, content: body };

  // Recursively walk referenced objects based on type
  switch (type) {
    case 1: {
      // COMMIT
      try {
        const commit = await commits.loadCommit(id);
        yield* walkObject(commit.tree, haveSet, seen, repositoryAccess, commits, trees, tags);
        for (const parentId of commit.parents) {
          yield* walkObject(parentId, haveSet, seen, repositoryAccess, commits, trees, tags);
        }
      } catch {
        // Ignore errors loading commit details
      }
      break;
    }

    case 2: {
      // TREE
      try {
        for await (const entry of trees.loadTree(id)) {
          yield* walkObject(entry.id, haveSet, seen, repositoryAccess, commits, trees, tags);
        }
      } catch {
        // Ignore errors loading tree entries
      }
      break;
    }

    case 4: {
      // TAG
      if (tags) {
        try {
          const tag = await tags.loadTag(id);
          yield* walkObject(tag.object, haveSet, seen, repositoryAccess, commits, trees, tags);
        } catch {
          // Ignore errors loading tag details
        }
      }
      break;
    }

    // BLOB (type 3) has no references to walk
  }
}

/**
 * Parse Git object to extract type and body content.
 */
function parseGitObject(data: Uint8Array): { type: ObjectTypeCode; body: Uint8Array } {
  // Find null byte after header
  let nullIdx = -1;
  for (let i = 0; i < Math.min(data.length, 32); i++) {
    if (data[i] === 0x00) {
      nullIdx = i;
      break;
    }
  }

  if (nullIdx < 0) {
    throw new Error("Invalid Git object: no header null byte");
  }

  const header = new TextDecoder().decode(data.subarray(0, nullIdx));
  const spaceIdx = header.indexOf(" ");
  if (spaceIdx < 0) {
    throw new Error("Invalid Git object header");
  }

  const typeStr = header.substring(0, spaceIdx);
  const type = stringToObjectType(typeStr);
  if (type === null) {
    throw new Error(`Unknown object type: ${typeStr}`);
  }

  return {
    type,
    body: data.subarray(nullIdx + 1),
  };
}

/**
 * Convert type string to ObjectTypeCode.
 */
function stringToObjectType(str: string): ObjectTypeCode | null {
  switch (str) {
    case "commit":
      return 1;
    case "tree":
      return 2;
    case "blob":
      return 3;
    case "tag":
      return 4;
    default:
      return null;
  }
}

/**
 * Create GitHttpServer options from VCS store resolver.
 *
 * Convenience factory for setting up server with VCS stores.
 *
 * @example
 * ```typescript
 * const server = createGitHttpServer(
 *   createVcsServerOptions(async (request, repoPath) => {
 *     return { repositoryAccess, refs, commits, trees };
 *   })
 * );
 * ```
 */
export function createVcsServerOptions(
  resolveStores: VcsRepositoryResolver,
  options?: Partial<GitHttpServerOptionsBase>,
): GitHttpServerOptionsWithResolver {
  return {
    ...options,
    resolveRepository: async (request, repoPath) => {
      const stores = await resolveStores(request, repoPath);
      if (!stores) return null;
      return createVcsRepositoryAdapter(stores);
    },
  };
}

/**
 * Base options without resolveRepository (for spreading).
 */
type GitHttpServerOptionsBase = Omit<
  import("../http-server/types.js").GitHttpServerOptions,
  "resolveRepository"
>;

/**
 * Options with resolveRepository.
 */
type GitHttpServerOptionsWithResolver = import("../http-server/types.js").GitHttpServerOptions;
