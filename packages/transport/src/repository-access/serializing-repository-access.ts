/**
 * SerializingRepositoryAccess - Serialize typed objects to wire format
 *
 * For SQL/KV/Memory backends that store typed objects and need to
 * serialize them to Git wire format for transport operations.
 */

import {
  type BlobStore,
  type CommitStore,
  type ObjectId,
  ObjectType,
  type ObjectTypeCode,
  serializeCommit,
  serializeTag,
  serializeTree,
  type TagStore,
  type TreeStore,
} from "@statewalker/vcs-core";
import { sha1 } from "@statewalker/vcs-utils/hash/sha1";
import { bytesToHex } from "@statewalker/vcs-utils/hash/utils";
import { collect } from "@statewalker/vcs-utils/streams";
import type { ObjectData, RepositoryAccess, RepositoryObjectInfo } from "./repository-access.js";

/**
 * SerializingRepositoryAccess implementation
 *
 * Provides RepositoryAccess by serializing typed objects from
 * individual stores (commits, trees, blobs, tags) to Git wire format.
 *
 * Use this for storage backends that store objects in structured format
 * rather than Git's wire format.
 *
 * Note: This implementation does not support enumeration since the
 * underlying stores don't provide list methods. Use GitNativeRepositoryAccess
 * for full enumeration support.
 */
export class SerializingRepositoryAccess implements RepositoryAccess {
  constructor(
    private readonly commits: CommitStore,
    private readonly trees: TreeStore,
    private readonly blobs: BlobStore,
    private readonly tags: TagStore,
  ) {}

  async has(id: ObjectId): Promise<boolean> {
    // Check each store
    if (await this.commits.hasCommit(id)) return true;
    if (await this.trees.hasTree(id)) return true;
    if (await this.blobs.has(id)) return true;
    if (await this.tags.hasTag(id)) return true;
    return false;
  }

  async getInfo(id: ObjectId): Promise<RepositoryObjectInfo | null> {
    // Try each store in order
    try {
      const commit = await this.commits.loadCommit(id);
      if (commit) {
        const content = serializeCommit(commit);
        return { id, type: ObjectType.COMMIT, size: content.length };
      }
    } catch {
      // Not a commit
    }

    try {
      if (await this.trees.hasTree(id)) {
        const entries: { mode: number; name: string; id: string }[] = [];
        for await (const entry of this.trees.loadTree(id)) {
          entries.push(entry);
        }
        const content = serializeTree(entries);
        return { id, type: ObjectType.TREE, size: content.length };
      }
    } catch {
      // Not a tree
    }

    try {
      if (await this.blobs.has(id)) {
        const content = await collect(this.blobs.load(id));
        return { id, type: ObjectType.BLOB, size: content.length };
      }
    } catch {
      // Not a blob
    }

    try {
      const tag = await this.tags.loadTag(id);
      if (tag) {
        const content = serializeTag(tag);
        return { id, type: ObjectType.TAG, size: content.length };
      }
    } catch {
      // Not a tag
    }

    return null;
  }

  async load(id: ObjectId): Promise<ObjectData | null> {
    // Try each store in order
    try {
      const commit = await this.commits.loadCommit(id);
      if (commit) {
        const content = serializeCommit(commit);
        return { type: ObjectType.COMMIT, content };
      }
    } catch {
      // Not a commit
    }

    try {
      if (await this.trees.hasTree(id)) {
        const entries: { mode: number; name: string; id: string }[] = [];
        for await (const entry of this.trees.loadTree(id)) {
          entries.push(entry);
        }
        const content = serializeTree(entries);
        return { type: ObjectType.TREE, content };
      }
    } catch {
      // Not a tree
    }

    try {
      if (await this.blobs.has(id)) {
        const content = await collect(this.blobs.load(id));
        return { type: ObjectType.BLOB, content };
      }
    } catch {
      // Not a blob
    }

    try {
      const tag = await this.tags.loadTag(id);
      if (tag) {
        const content = serializeTag(tag);
        return { type: ObjectType.TAG, content };
      }
    } catch {
      // Not a tag
    }

    return null;
  }

  async store(type: ObjectTypeCode, content: Uint8Array): Promise<ObjectId> {
    // Compute object ID
    const typeString = TYPE_CODE_TO_STRING[type];
    const header = new TextEncoder().encode(`${typeString} ${content.length}\0`);
    const fullContent = new Uint8Array(header.length + content.length);
    fullContent.set(header);
    fullContent.set(content, header.length);
    const hashBytes = await sha1(fullContent);
    const id = bytesToHex(hashBytes);

    // Store in appropriate store
    // Note: For a full implementation, we'd parse the content and store
    // in the appropriate typed store. For now, we only support blobs.
    if (type === ObjectType.BLOB) {
      await this.blobs.store([content]);
    }
    // Commits, trees, and tags would need parsing before storage
    // This is typically done through the higher-level APIs

    return id;
  }

  enumerate(): AsyncIterable<ObjectId> {
    // Note: The underlying stores don't provide list methods
    // This is a limitation of SerializingRepositoryAccess
    // Use GitNativeRepositoryAccess for full enumeration support
    throw new Error(
      "enumerate() is not supported by SerializingRepositoryAccess. " +
        "Use GitNativeRepositoryAccess for enumeration.",
    );
  }

  enumerateWithInfo(): AsyncIterable<RepositoryObjectInfo> {
    // Note: The underlying stores don't provide list methods
    throw new Error(
      "enumerateWithInfo() is not supported by SerializingRepositoryAccess. " +
        "Use GitNativeRepositoryAccess for enumeration.",
    );
  }

  async loadWireFormat(id: ObjectId): Promise<Uint8Array | null> {
    const data = await this.load(id);
    if (!data) return null;

    // Add Git header
    const typeString = TYPE_CODE_TO_STRING[data.type];
    const header = new TextEncoder().encode(`${typeString} ${data.content.length}\0`);
    const result = new Uint8Array(header.length + data.content.length);
    result.set(header);
    result.set(data.content, header.length);
    return result;
  }
}

/**
 * Map from ObjectTypeCode to string
 */
const TYPE_CODE_TO_STRING: Record<ObjectTypeCode, string> = {
  [ObjectType.COMMIT]: "commit",
  [ObjectType.TREE]: "tree",
  [ObjectType.BLOB]: "blob",
  [ObjectType.TAG]: "tag",
};
