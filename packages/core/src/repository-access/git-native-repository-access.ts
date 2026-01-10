/**
 * GitNativeRepositoryAccess - Direct passthrough to GitObjectStore
 *
 * For Git-native storage backends that already store objects in wire format.
 * No serialization overhead - just delegates to the underlying store.
 */

import { collect } from "@statewalker/vcs-utils/streams";
import type { ObjectId } from "../id/object-id.js";
import type { GitObjectStore } from "../objects/object-store.js";
import {
  ObjectType,
  type ObjectTypeCode,
  type ObjectTypeString,
} from "../objects/object-types.js";
import type {
  DeltaAwareRepositoryAccess,
  ObjectData,
  RepositoryAccess,
  RepositoryObjectInfo,
} from "./repository-access.js";

/**
 * Map from ObjectTypeString to ObjectTypeCode
 */
const TYPE_STRING_TO_CODE: Record<string, ObjectTypeCode> = {
  commit: ObjectType.COMMIT,
  tree: ObjectType.TREE,
  blob: ObjectType.BLOB,
  tag: ObjectType.TAG,
};

/**
 * Map from ObjectTypeCode to ObjectTypeString
 */
const TYPE_CODE_TO_STRING: Record<ObjectTypeCode, ObjectTypeString> = {
  [ObjectType.COMMIT]: "commit",
  [ObjectType.TREE]: "tree",
  [ObjectType.BLOB]: "blob",
  [ObjectType.TAG]: "tag",
};

/**
 * GitNativeRepositoryAccess implementation
 *
 * Direct passthrough to GitObjectStore - no serialization overhead.
 * Uses the existing GitObjectStore for all operations.
 */
export class GitNativeRepositoryAccess implements RepositoryAccess {
  constructor(protected readonly objectStore: GitObjectStore) {}

  async has(id: ObjectId): Promise<boolean> {
    return this.objectStore.has(id);
  }

  async getInfo(id: ObjectId): Promise<RepositoryObjectInfo | null> {
    try {
      const header = await this.objectStore.getHeader(id);
      return {
        id,
        type: TYPE_STRING_TO_CODE[header.type],
        size: header.size,
      };
    } catch {
      return null;
    }
  }

  async load(id: ObjectId): Promise<ObjectData | null> {
    try {
      const [header, contentStream] = await this.objectStore.loadWithHeader(id);
      const content = await collect(contentStream);
      return {
        type: TYPE_STRING_TO_CODE[header.type],
        content,
      };
    } catch {
      return null;
    }
  }

  async store(type: ObjectTypeCode, content: Uint8Array): Promise<ObjectId> {
    const typeString = TYPE_CODE_TO_STRING[type];
    return this.objectStore.store(typeString, [content]);
  }

  async *enumerate(): AsyncIterable<ObjectId> {
    yield* this.objectStore.list();
  }

  async *enumerateWithInfo(): AsyncIterable<RepositoryObjectInfo> {
    for await (const id of this.objectStore.list()) {
      const info = await this.getInfo(id);
      if (info) {
        yield info;
      }
    }
  }

  async loadWireFormat(id: ObjectId): Promise<Uint8Array | null> {
    try {
      return await collect(this.objectStore.loadRaw(id));
    } catch {
      return null;
    }
  }
}

/**
 * Interface for delta-aware storage
 */
export interface DeltaAwareStore {
  isDelta(id: ObjectId): Promise<boolean>;
  getDeltaBase(id: ObjectId): Promise<ObjectId | null>;
  getChainDepth(id: ObjectId): Promise<number>;
}

/**
 * GitNativeRepositoryAccess with delta awareness
 *
 * Extends GitNativeRepositoryAccess with delta storage information.
 */
export class DeltaAwareGitNativeRepositoryAccess
  extends GitNativeRepositoryAccess
  implements DeltaAwareRepositoryAccess
{
  constructor(
    objectStore: GitObjectStore,
    private readonly deltaStore: DeltaAwareStore
  ) {
    super(objectStore);
  }

  async isDelta(id: ObjectId): Promise<boolean> {
    return this.deltaStore.isDelta(id);
  }

  async getDeltaBase(id: ObjectId): Promise<ObjectId | null> {
    return this.deltaStore.getDeltaBase(id);
  }

  async getChainDepth(id: ObjectId): Promise<number> {
    return this.deltaStore.getChainDepth(id);
  }
}
