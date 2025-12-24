/**
 * Repository Adapter
 *
 * Adapts the Repository interface from @webrun-vcs/core to the
 * RepositoryAccess interface used by HTTP protocol handlers.
 *
 * This adapter provides a clean integration layer that uses only the
 * standard Repository interface, making transport work with any
 * Repository implementation (Git, SQL, memory, etc.).
 */

import type {
  CommitStore,
  GitObjectStore,
  Ref,
  Repository,
  SymbolicRef,
  TagStore,
  TreeStore,
} from "@webrun-vcs/core";
import type {
  HeadInfo,
  ObjectId,
  ObjectInfo,
  ObjectTypeCode,
  RefInfo,
  RepositoryAccess,
} from "../handlers/types.js";

/**
 * Create RepositoryAccess from a Repository.
 *
 * @param repository - Repository implementation from @webrun-vcs/core
 * @returns RepositoryAccess interface for protocol handlers
 */
export function createRepositoryAdapter(repository: Repository): RepositoryAccess {
  const { objects, refs, commits, trees, tags } = repository;

  const checkIsSymbolicRef = (ref: Ref | SymbolicRef): ref is SymbolicRef => {
    return "target" in ref && typeof ref.target === "string";
  };

  return {
    /**
     * List all refs in the repository.
     */
    async *listRefs(): AsyncIterable<RefInfo> {
      for await (const ref of refs.list()) {
        if (checkIsSymbolicRef(ref)) {
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
      return objects.has(id);
    },

    /**
     * Get object type and size.
     */
    async getObjectInfo(id: ObjectId): Promise<ObjectInfo | null> {
      try {
        const header = await objects.getHeader(id);
        const type = stringToObjectType(header.type);
        if (!type) return null;
        return { type, size: header.size };
      } catch {
        return null;
      }
    },

    /**
     * Load object content (raw with header).
     */
    async *loadObject(id: ObjectId): AsyncIterable<Uint8Array> {
      yield* objects.loadRaw(id);
    },

    /**
     * Store an object.
     */
    async storeObject(type: ObjectTypeCode, content: Uint8Array): Promise<ObjectId> {
      const typeStr = objectTypeToString(type);
      return objects.store(typeStr, [content]);
    },

    /**
     * Update a ref.
     */
    async updateRef(
      name: string,
      oldId: ObjectId | null,
      newId: ObjectId | null,
    ): Promise<boolean> {
      if (newId === null) {
        return refs.delete(name);
      }

      if (oldId !== null) {
        const result = await refs.compareAndSwap(name, oldId, newId);
        return result.success;
      }

      await refs.set(name, newId);
      return true;
    },

    /**
     * Walk object graph from starting points.
     */
    async *walkObjects(
      wants: ObjectId[],
      haves: ObjectId[],
    ): AsyncIterable<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
      const haveSet = new Set(haves);
      const seen = new Set<ObjectId>();

      for (const wantId of wants) {
        yield* walkObject(wantId, haveSet, seen, objects, commits, trees, tags);
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
  objects: GitObjectStore,
  commits: CommitStore,
  trees: TreeStore,
  tags?: TagStore,
): AsyncGenerator<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
  if (seen.has(id) || haveSet.has(id)) return;
  seen.add(id);

  const content = await collectContent(objects.loadRaw(id));
  const { type, body } = parseGitObject(content);

  yield { id, type, content: body };

  switch (type) {
    case 1: {
      // COMMIT
      try {
        const commit = await commits.loadCommit(id);
        yield* walkObject(commit.tree, haveSet, seen, objects, commits, trees, tags);
        for (const parentId of commit.parents) {
          yield* walkObject(parentId, haveSet, seen, objects, commits, trees, tags);
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
          yield* walkObject(entry.id, haveSet, seen, objects, commits, trees, tags);
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
          yield* walkObject(tag.object, haveSet, seen, objects, commits, trees, tags);
        } catch {
          // Ignore errors loading tag details
        }
      }
      break;
    }
  }
}

/**
 * Parse Git object to extract type and body content.
 */
function parseGitObject(data: Uint8Array): { type: ObjectTypeCode; body: Uint8Array } {
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
 * Convert ObjectTypeCode to type string.
 */
function objectTypeToString(type: ObjectTypeCode): "commit" | "tree" | "blob" | "tag" {
  switch (type) {
    case 1:
      return "commit";
    case 2:
      return "tree";
    case 3:
      return "blob";
    case 4:
      return "tag";
    default:
      throw new Error(`Unknown type code: ${type}`);
  }
}

/**
 * Collect all chunks from async iterable into single Uint8Array.
 */
async function collectContent(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return concatBytes(chunks);
}

/**
 * Concatenate byte arrays.
 */
function concatBytes(arrays: Uint8Array[]): Uint8Array {
  if (arrays.length === 0) return new Uint8Array(0);
  if (arrays.length === 1) return arrays[0];

  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Factory function type for resolving repository.
 */
export type RepositoryResolver = (request: Request, repoPath: string) => Promise<Repository | null>;

/**
 * Create GitHttpServer options from Repository resolver.
 *
 * Convenience factory for setting up server with Repository interface.
 *
 * @example
 * ```typescript
 * const server = createGitHttpServer(
 *   createRepositoryServerOptions(async (request, repoPath) => {
 *     return await openRepository(repoPath);
 *   })
 * );
 * ```
 */
export function createRepositoryServerOptions(
  resolveRepository: RepositoryResolver,
  options?: Partial<GitHttpServerOptionsBase>,
): GitHttpServerOptionsWithResolver {
  return {
    ...options,
    resolveRepository: async (request, repoPath) => {
      const repository = await resolveRepository(request, repoPath);
      if (!repository) return null;
      return createRepositoryAdapter(repository);
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
