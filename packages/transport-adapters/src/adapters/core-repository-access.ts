/**
 * RepositoryAccess adapter for core storage.
 *
 * Adapts GitObjectStore and RefStore from @statewalker/vcs-core to the
 * RepositoryAccess interface used by protocol handlers.
 *
 * This adapter enables upload-pack and receive-pack handlers to work
 * with the core storage implementation.
 */

import {
  type GitObjectStore,
  isSymbolicRef,
  type ObjectId,
  ObjectType,
  type ObjectTypeCode,
  type ObjectTypeString,
  parseCommit,
  parseTree,
  type Ref,
  type RefStore,
} from "@statewalker/vcs-core";
import type { HeadInfo, ObjectInfo, RefInfo, RepositoryAccess } from "@statewalker/vcs-transport";
import { collect } from "@statewalker/vcs-utils/streams";

/**
 * Type mapping from string to code.
 */
const TYPE_STRING_TO_CODE: Record<ObjectTypeString, ObjectTypeCode> = {
  commit: ObjectType.COMMIT,
  tree: ObjectType.TREE,
  blob: ObjectType.BLOB,
  tag: ObjectType.TAG,
};

/**
 * Type mapping from code to string.
 */
const TYPE_CODE_TO_STRING: Record<ObjectTypeCode, ObjectTypeString> = {
  [ObjectType.COMMIT]: "commit",
  [ObjectType.TREE]: "tree",
  [ObjectType.BLOB]: "blob",
  [ObjectType.TAG]: "tag",
};

/**
 * Options for creating a core repository access adapter.
 */
export interface CoreRepositoryAccessOptions {
  /** Object store for Git objects */
  objectStore: GitObjectStore;
  /** Reference store for Git refs */
  refStore: RefStore;
}

/**
 * Create a RepositoryAccess adapter from core storage.
 *
 * @param options - Object store and ref store
 * @returns RepositoryAccess implementation
 */
export function createCoreRepositoryAccess(options: CoreRepositoryAccessOptions): RepositoryAccess {
  const { objectStore, refStore } = options;

  return {
    async *listRefs(): AsyncIterable<RefInfo> {
      for await (const ref of refStore.list()) {
        if (isSymbolicRef(ref)) {
          // Resolve symbolic refs to get the object ID
          const resolved = await refStore.resolve(ref.name);
          if (resolved?.objectId) {
            yield {
              name: ref.name,
              objectId: resolved.objectId,
            };
          }
        } else {
          const directRef = ref as Ref;
          if (directRef.objectId) {
            yield {
              name: directRef.name,
              objectId: directRef.objectId,
              peeledId: directRef.peeledObjectId,
            };
          }
        }
      }
    },

    async getHead(): Promise<HeadInfo | null> {
      const head = await refStore.get("HEAD");
      if (!head) {
        return null;
      }

      if (isSymbolicRef(head)) {
        // Symbolic HEAD - resolve to get the object ID
        const resolved = await refStore.resolve("HEAD");
        return {
          objectId: resolved?.objectId,
          target: head.target,
        };
      }

      // Detached HEAD
      const directRef = head as Ref;
      return {
        objectId: directRef.objectId,
      };
    },

    async hasObject(id: ObjectId): Promise<boolean> {
      return objectStore.has(id);
    },

    async getObjectInfo(id: ObjectId): Promise<ObjectInfo | null> {
      try {
        const header = await objectStore.getHeader(id);
        const typeCode = TYPE_STRING_TO_CODE[header.type];
        if (typeCode === undefined) {
          return null;
        }
        return {
          type: typeCode,
          size: header.size,
        };
      } catch {
        return null;
      }
    },

    async *loadObject(id: ObjectId): AsyncIterable<Uint8Array> {
      yield* objectStore.load(id);
    },

    async storeObject(type: ObjectTypeCode, content: Uint8Array): Promise<ObjectId> {
      const typeString = TYPE_CODE_TO_STRING[type];
      if (!typeString) {
        throw new Error(`Unknown type code: ${type}`);
      }
      return objectStore.store(typeString, [content]);
    },

    async updateRef(
      name: string,
      oldId: ObjectId | null,
      newId: ObjectId | null,
    ): Promise<boolean> {
      // Delete case
      if (newId === null) {
        if (oldId !== null) {
          // Check current value before deleting
          const resolved = await refStore.resolve(name);
          if (resolved?.objectId !== oldId) {
            return false;
          }
        }
        return refStore.delete(name);
      }

      // Create or update case
      const result = await refStore.compareAndSwap(name, oldId ?? undefined, newId);
      return result.success;
    },

    async *walkObjects(
      wants: ObjectId[],
      haves: ObjectId[],
    ): AsyncIterable<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
      const haveSet = new Set(haves);
      const seen = new Set<ObjectId>();

      // Process wants in order
      for (const wantId of wants) {
        yield* walkObject(wantId, objectStore, haveSet, seen);
      }
    },
  };
}

/**
 * Walk a single object and its dependencies.
 */
async function* walkObject(
  id: ObjectId,
  objectStore: GitObjectStore,
  haves: Set<ObjectId>,
  seen: Set<ObjectId>,
): AsyncGenerator<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
  // Skip if already seen or client has it
  if (seen.has(id) || haves.has(id)) {
    return;
  }
  seen.add(id);

  // Check if object exists
  const exists = await objectStore.has(id);
  if (!exists) {
    throw new Error(`Object not found: ${id}`);
  }

  // Load object with header
  const [header, contentStream] = await objectStore.loadWithHeader(id);
  const content = await collect(contentStream);
  const typeCode = TYPE_STRING_TO_CODE[header.type];

  if (typeCode === undefined) {
    throw new Error(`Unknown object type: ${header.type}`);
  }

  // Yield the object
  yield { id, type: typeCode, content };

  // Walk dependencies based on type
  switch (typeCode) {
    case ObjectType.COMMIT:
      yield* walkCommit(content, objectStore, haves, seen);
      break;

    case ObjectType.TREE:
      yield* walkTree(content, objectStore, haves, seen);
      break;

    case ObjectType.TAG:
      yield* walkTag(content, objectStore, haves, seen);
      break;

    // Blobs have no dependencies
  }
}

/**
 * Walk a commit object's dependencies.
 */
async function* walkCommit(
  content: Uint8Array,
  objectStore: GitObjectStore,
  haves: Set<ObjectId>,
  seen: Set<ObjectId>,
): AsyncGenerator<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
  try {
    const commit = parseCommit(content);

    // Walk tree first
    yield* walkObject(commit.tree, objectStore, haves, seen);

    // Walk parents (stop at haves boundary)
    for (const parent of commit.parents) {
      yield* walkObject(parent, objectStore, haves, seen);
    }
  } catch {
    // If we can't parse the commit, just skip its dependencies
  }
}

/**
 * Walk a tree object's dependencies.
 */
async function* walkTree(
  content: Uint8Array,
  objectStore: GitObjectStore,
  haves: Set<ObjectId>,
  seen: Set<ObjectId>,
): AsyncGenerator<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
  try {
    for (const entry of parseTree(content)) {
      yield* walkObject(entry.id, objectStore, haves, seen);
    }
  } catch {
    // If we can't parse the tree, just skip its dependencies
  }
}

/**
 * Walk a tag object's dependencies.
 */
async function* walkTag(
  content: Uint8Array,
  objectStore: GitObjectStore,
  haves: Set<ObjectId>,
  seen: Set<ObjectId>,
): AsyncGenerator<{ id: ObjectId; type: ObjectTypeCode; content: Uint8Array }> {
  try {
    // Parse tag to find target object
    const targetId = parseTagTarget(content);
    if (targetId) {
      yield* walkObject(targetId, objectStore, haves, seen);
    }
  } catch {
    // If we can't parse the tag, just skip its dependencies
  }
}

/**
 * Parse a tag object to extract the target object ID.
 */
function parseTagTarget(content: Uint8Array): ObjectId | null {
  const decoder = new TextDecoder();
  const text = decoder.decode(content);
  const lines = text.split("\n");

  for (const line of lines) {
    if (line === "") {
      // End of headers
      break;
    }
    if (line.startsWith("object ")) {
      return line.substring(7).trim();
    }
  }

  return null;
}
