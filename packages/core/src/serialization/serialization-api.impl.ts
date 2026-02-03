/**
 * SerializationApi implementation
 *
 * Wraps existing pack and compression utilities to provide the SerializationApi interface.
 * Supports both the new History interface (recommended) and the deprecated StructuredStores
 * for backward compatibility during migration.
 */

import { deflate, inflate } from "@statewalker/vcs-utils";
import { sha1 } from "@statewalker/vcs-utils/hash/sha1";
import { bytesToHex } from "@statewalker/vcs-utils/hash/utils";
import { PackObjectType, PackWriterStream, parsePackEntries } from "../backend/git/pack/index.js";
import type { ObjectId } from "../common/id/index.js";
import type { BlobStore } from "../history/blobs/blob-store.js";
import type { BlobContent, Blobs } from "../history/blobs/blobs.js";
import type { Commit, CommitStore } from "../history/commits/commit-store.js";
import type { Commits } from "../history/commits/commits.js";
import type { History } from "../history/history.js";
import type { ObjectTypeString } from "../history/objects/object-types.js";
import type { AnnotatedTag, TagStore } from "../history/tags/tag-store.js";
import type { Tag, Tags } from "../history/tags/tags.js";
import type { TreeEntry } from "../history/trees/tree-entry.js";
import type { TreeStore } from "../history/trees/tree-store.js";
import type { Trees } from "../history/trees/trees.js";
import type { BlobDeltaApi } from "../storage/delta/blob-delta-api.js";
import type {
  PackBuilder,
  PackBuildStats,
  PackEntry,
  PackHeader,
  PackImportResult,
  PackOptions,
  PackReaderApi,
  ParsedObjectMeta,
  SerializationApi,
} from "./serialization-api.js";

/**
 * Configuration for DefaultSerializationApi
 */
export interface SerializationApiConfig {
  /**
   * History facade for object access (recommended)
   *
   * Use this when you have a History instance from:
   * - createHistoryWithOperations()
   * - createHistoryFromStores()
   * - createMemoryHistory()
   */
  history?: History;

  /**
   * Direct store access for object access
   *
   * Use these when you have individual store instances from a StorageBackend.
   * All four stores must be provided together if using this approach.
   */
  blobs?: BlobStore;
  trees?: TreeStore;
  commits?: CommitStore;
  tags?: TagStore;
  refs?: unknown; // Refs are not used by serialization but included for API consistency

  /** Blob delta API for delta-aware import */
  blobDeltaApi?: BlobDeltaApi;
}

/**
 * Default implementation of SerializationApi
 *
 * Uses existing pack utilities and compression functions.
 * Supports both History facade (new) and StructuredStores (deprecated).
 */
export class DefaultSerializationApi implements SerializationApi {
  /** Blob storage interface (new interface) */
  private readonly _blobs: Blobs;
  /** Tree storage interface (new interface) */
  private readonly _trees: Trees;
  /** Commit storage interface (new interface) */
  private readonly _commits: Commits;
  /** Tag storage interface (new interface) */
  private readonly _tags: Tags;
  /** Optional blob delta API for delta-aware import */
  private readonly blobDeltaApi?: BlobDeltaApi;

  constructor(config: SerializationApiConfig) {
    if (config.history) {
      // Use new History interface directly
      this._blobs = config.history.blobs;
      this._trees = config.history.trees;
      this._commits = config.history.commits;
      this._tags = config.history.tags;
    } else if (config.blobs && config.trees && config.commits && config.tags) {
      // Use direct store properties - adapt to new interfaces
      this._blobs = new BlobsLegacyAdapter(config.blobs);
      this._trees = new TreesLegacyAdapter(config.trees);
      this._commits = new CommitsLegacyAdapter(config.commits);
      this._tags = new TagsLegacyAdapter(config.tags);
    } else {
      throw new Error(
        "SerializationApiConfig must have either 'history' or all store properties (blobs, trees, commits, tags)",
      );
    }
    this.blobDeltaApi = config.blobDeltaApi;
  }

  /**
   * Serialize an object to Git loose format
   */
  async *serializeLooseObject(id: ObjectId): AsyncIterable<Uint8Array> {
    const { type, content } = await this.exportObject(id);

    // Collect content to get size
    const chunks: Uint8Array[] = [];
    for await (const chunk of content) {
      chunks.push(chunk);
    }
    const contentBytes = concatBytes(chunks);

    // Create header: "type size\0"
    const header = new TextEncoder().encode(`${type} ${contentBytes.length}\0`);

    // Concatenate header and content
    const fullData = concatBytes([header, contentBytes]);

    // Compress with zlib (not raw deflate)
    yield* deflate(toAsyncIterable(fullData), { raw: false });
  }

  /**
   * Parse Git loose format and store
   */
  async parseLooseObject(compressed: AsyncIterable<Uint8Array>): Promise<ParsedObjectMeta> {
    // Decompress
    const decompressedChunks: Uint8Array[] = [];
    for await (const chunk of inflate(compressed, { raw: false })) {
      decompressedChunks.push(chunk);
    }
    const data = concatBytes(decompressedChunks);

    // Parse header: "type size\0content"
    const nullIndex = data.indexOf(0);
    if (nullIndex === -1) {
      throw new Error("Invalid loose object: no null byte found");
    }

    const headerStr = new TextDecoder().decode(data.subarray(0, nullIndex));
    const spaceIndex = headerStr.indexOf(" ");
    if (spaceIndex === -1) {
      throw new Error("Invalid loose object header: no space found");
    }

    const type = headerStr.substring(0, spaceIndex) as ObjectTypeString;
    const size = parseInt(headerStr.substring(spaceIndex + 1), 10);
    const content = data.subarray(nullIndex + 1);

    if (content.length !== size) {
      throw new Error(`Size mismatch: header says ${size}, content is ${content.length}`);
    }

    // Compute ID (SHA-1 of header + content)
    const hash = await sha1(data);
    const id = bytesToHex(hash);

    // Store the object
    await this.importObject(type, toAsyncIterable(content));

    return { id, type, size };
  }

  /**
   * Create a pack file from objects
   */
  async *createPack(
    objects: AsyncIterable<ObjectId>,
    options?: PackOptions,
  ): AsyncIterable<Uint8Array> {
    const builder = this.createPackBuilder(options);

    for await (const id of objects) {
      if (options?.useDelta !== false) {
        await builder.addObjectWithDelta(id);
      } else {
        await builder.addObject(id);
      }
    }

    yield* builder.finalize();
  }

  /**
   * Import objects from a pack file
   */
  async importPack(pack: AsyncIterable<Uint8Array>): Promise<PackImportResult> {
    // Collect pack data
    const chunks: Uint8Array[] = [];
    for await (const chunk of pack) {
      chunks.push(chunk);
    }
    const packData = concatBytes(chunks);

    // Parse pack entries
    const result = await parsePackEntries(packData);

    let blobsWithDelta = 0;
    let treesImported = 0;
    let commitsImported = 0;
    let tagsImported = 0;

    for (const entry of result.entries) {
      switch (entry.objectType) {
        case "blob":
          if (entry.type === "delta" && this.blobDeltaApi) {
            // Preserve blob delta if we have delta API
            const { serializeDeltaToGit } = await import("../storage/delta/delta-binary-format.js");
            const deltaBytes = serializeDeltaToGit(entry.delta);
            await this.blobDeltaApi.deltifyBlob(
              entry.id,
              entry.baseId,
              toAsyncIterable(deltaBytes),
            );
            blobsWithDelta++;
          } else {
            // Store as full blob
            await this._blobs.store([entry.content]);
          }
          break;

        case "tree":
          // Trees are always stored fully resolved
          await this.storeTreeFromContent(entry.content);
          treesImported++;
          break;

        case "commit":
          // Commits are always stored fully resolved
          await this.storeCommitFromContent(entry.content);
          commitsImported++;
          break;

        case "tag":
          // Tags are always stored fully resolved
          await this.storeTagFromContent(entry.content);
          tagsImported++;
          break;
      }
    }

    return {
      objectsImported: result.entries.length,
      blobsWithDelta,
      treesImported,
      commitsImported,
      tagsImported,
    };
  }

  /**
   * Create incremental pack builder
   */
  createPackBuilder(options?: PackOptions): PackBuilder {
    return new DefaultPackBuilder(this._blobs, this._trees, this._commits, this._tags, options);
  }

  /**
   * Create pack file reader
   */
  createPackReader(pack: AsyncIterable<Uint8Array>): PackReaderApi {
    return new StreamingPackReader(pack);
  }

  /**
   * Export single object
   */
  async exportObject(
    id: ObjectId,
  ): Promise<{ type: ObjectTypeString; content: AsyncIterable<Uint8Array> }> {
    // Try each object type
    if (await this._blobs.has(id)) {
      const content = await this._blobs.load(id);
      if (!content) throw new Error(`Blob not found: ${id}`);
      return { type: "blob", content };
    }

    if (await this._trees.has(id)) {
      return { type: "tree", content: this.serializeTree(id) };
    }

    if (await this._commits.has(id)) {
      return { type: "commit", content: this.serializeCommit(id) };
    }

    if (await this._tags.has(id)) {
      return { type: "tag", content: this.serializeTag(id) };
    }

    throw new Error(`Object not found: ${id}`);
  }

  /**
   * Import single object
   */
  async importObject(
    type: ObjectTypeString,
    content: AsyncIterable<Uint8Array>,
  ): Promise<ObjectId> {
    switch (type) {
      case "blob":
        return this._blobs.store(content);
      case "tree":
        return this.storeTreeFromStream(content);
      case "commit":
        return this.storeCommitFromStream(content);
      case "tag":
        return this.storeTagFromStream(content);
      default:
        throw new Error(`Unknown object type: ${type}`);
    }
  }

  // ============ Private helpers ============

  private async *serializeTree(id: ObjectId): AsyncIterable<Uint8Array> {
    const { hexToBytes } = await import("@statewalker/vcs-utils/hash/utils");
    const entries: Uint8Array[] = [];

    const tree = await this._trees.load(id);
    if (!tree) throw new Error(`Tree not found: ${id}`);

    for await (const entry of tree) {
      // Format: "mode name\0<20-byte-sha>"
      const modeAndName = new TextEncoder().encode(`${entry.mode.toString(8)} ${entry.name}\0`);
      const sha = hexToBytes(entry.id);
      entries.push(concatBytes([modeAndName, sha]));
    }

    yield concatBytes(entries);
  }

  private async *serializeCommit(id: ObjectId): AsyncIterable<Uint8Array> {
    const { serializeCommit } = await import("../history/commits/commit-format.js");
    const commit = await this._commits.load(id);
    if (!commit) throw new Error(`Commit not found: ${id}`);
    yield serializeCommit(commit);
  }

  private async *serializeTag(id: ObjectId): AsyncIterable<Uint8Array> {
    const { serializeTag } = await import("../history/tags/tag-format.js");
    const tag = await this._tags.load(id);
    if (!tag) throw new Error(`Tag not found: ${id}`);
    yield serializeTag(tag);
  }

  private async storeTreeFromContent(content: Uint8Array): Promise<ObjectId> {
    const { parseTreeToArray } = await import("../history/trees/tree-format.js");
    const entries = parseTreeToArray(content);
    return this._trees.store(entries);
  }

  private async storeTreeFromStream(content: AsyncIterable<Uint8Array>): Promise<ObjectId> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of content) {
      chunks.push(chunk);
    }
    return this.storeTreeFromContent(concatBytes(chunks));
  }

  private async storeCommitFromContent(content: Uint8Array): Promise<ObjectId> {
    const { parseCommit } = await import("../history/commits/commit-format.js");
    const commit = parseCommit(content);
    return this._commits.store(commit);
  }

  private async storeCommitFromStream(content: AsyncIterable<Uint8Array>): Promise<ObjectId> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of content) {
      chunks.push(chunk);
    }
    return this.storeCommitFromContent(concatBytes(chunks));
  }

  private async storeTagFromContent(content: Uint8Array): Promise<ObjectId> {
    const { parseTag } = await import("../history/tags/tag-format.js");
    const tag = parseTag(content);
    return this._tags.store(tag);
  }

  private async storeTagFromStream(content: AsyncIterable<Uint8Array>): Promise<ObjectId> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of content) {
      chunks.push(chunk);
    }
    return this.storeTagFromContent(concatBytes(chunks));
  }
}

/**
 * Default PackBuilder implementation
 */
class DefaultPackBuilder implements PackBuilder {
  private readonly _blobs: Blobs;
  private readonly _trees: Trees;
  private readonly _commits: Commits;
  private readonly _tags: Tags;
  private readonly writer: PackWriterStream;
  private readonly options: PackOptions;
  private stats: PackBuildStats = {
    totalObjects: 0,
    deltifiedObjects: 0,
    totalSize: 0,
    deltaSavings: 0,
  };
  private finalized = false;

  constructor(blobs: Blobs, trees: Trees, commits: Commits, tags: Tags, options?: PackOptions) {
    this._blobs = blobs;
    this._trees = trees;
    this._commits = commits;
    this._tags = tags;
    this.writer = new PackWriterStream();
    this.options = options ?? {};
  }

  async addObject(id: ObjectId): Promise<void> {
    if (this.finalized) {
      throw new Error("Pack already finalized");
    }

    const { type, content } = await this.loadObject(id);
    await this.writer.addObject(id, type, content);

    this.stats.totalObjects++;
    this.stats.totalSize += content.length;
    this.options.onProgress?.(this.stats);
  }

  async addObjectWithDelta(id: ObjectId, _preferredBaseId?: ObjectId): Promise<void> {
    // For now, just add as full object
    // TODO: Implement delta computation when preferredBaseId is provided
    await this.addObject(id);
  }

  async *finalize(): AsyncIterable<Uint8Array> {
    if (this.finalized) {
      throw new Error("Pack already finalized");
    }
    this.finalized = true;

    const result = await this.writer.finalize();
    yield result.packData;
  }

  getStats(): PackBuildStats {
    return { ...this.stats };
  }

  private async loadObject(id: ObjectId): Promise<{ type: PackObjectType; content: Uint8Array }> {
    // Try blobs first (most common)
    if (await this._blobs.has(id)) {
      const blobContent = await this._blobs.load(id);
      if (!blobContent) throw new Error(`Blob not found: ${id}`);
      const chunks: Uint8Array[] = [];
      for await (const chunk of blobContent) {
        chunks.push(chunk);
      }
      return { type: PackObjectType.BLOB, content: concatBytes(chunks) };
    }

    if (await this._trees.has(id)) {
      const { serializeTree } = await import("../history/trees/tree-format.js");
      const tree = await this._trees.load(id);
      if (!tree) throw new Error(`Tree not found: ${id}`);
      const entries: TreeEntry[] = [];
      for await (const entry of tree) {
        entries.push(entry);
      }
      return { type: PackObjectType.TREE, content: serializeTree(entries) };
    }

    if (await this._commits.has(id)) {
      const { serializeCommit } = await import("../history/commits/commit-format.js");
      const commit = await this._commits.load(id);
      if (!commit) throw new Error(`Commit not found: ${id}`);
      return { type: PackObjectType.COMMIT, content: serializeCommit(commit) };
    }

    if (await this._tags.has(id)) {
      const { serializeTag } = await import("../history/tags/tag-format.js");
      const tag = await this._tags.load(id);
      if (!tag) throw new Error(`Tag not found: ${id}`);
      return { type: PackObjectType.TAG, content: serializeTag(tag) };
    }

    throw new Error(`Object not found: ${id}`);
  }
}

/**
 * Streaming pack reader implementation
 */
class StreamingPackReader implements PackReaderApi {
  private packData: Uint8Array | null = null;
  private header: PackHeader | null = null;

  constructor(private readonly pack: AsyncIterable<Uint8Array>) {}

  async *entries(): AsyncIterable<PackEntry> {
    await this.ensureLoaded();
    if (!this.packData) {
      throw new Error("Pack data not loaded");
    }
    const result = await parsePackEntries(this.packData);

    for (const entry of result.entries) {
      const packEntry: PackEntry = {
        id: entry.id,
        type: entry.objectType,
        isDelta: entry.type === "delta",
        baseRef: entry.type === "delta" ? entry.baseId : undefined,
        rawContent: toAsyncIterable(entry.type === "delta" ? new Uint8Array(0) : entry.content),
        resolvedContent: toAsyncIterable(entry.content),
        size: entry.content.length,
        chainDepth: entry.type === "delta" ? 1 : 0, // Simplified
        ratio: entry.type === "delta" ? 0.5 : undefined, // Simplified
      };
      yield packEntry;
    }
  }

  async getHeader(): Promise<PackHeader> {
    await this.ensureLoaded();
    if (!this.header) {
      throw new Error("Pack header not loaded");
    }
    return this.header;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.packData) return;

    const chunks: Uint8Array[] = [];
    for await (const chunk of this.pack) {
      chunks.push(chunk);
    }
    this.packData = concatBytes(chunks);

    // Parse header
    if (this.packData.length < 12) {
      throw new Error("Pack data too short");
    }

    const view = new DataView(this.packData.buffer, this.packData.byteOffset);
    const signature = view.getUint32(0, false);
    if (signature !== 0x5041434b) {
      // "PACK"
      throw new Error("Invalid pack signature");
    }

    this.header = {
      version: view.getUint32(4, false),
      objectCount: view.getUint32(8, false),
    };
  }
}

// ============ Utility functions ============

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

async function* toAsyncIterable(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}

// ============ Legacy Adapters ============
// These adapters wrap the old store interfaces (BlobStore, TreeStore, etc.)
// to implement the new interfaces (Blobs, Trees, etc.) for backward compatibility.

/**
 * Adapter that wraps old BlobStore to implement new Blobs interface
 * @internal - For backward compatibility during migration
 */
class BlobsLegacyAdapter implements Blobs {
  constructor(private readonly blobStore: BlobStore) {}

  async store(content: BlobContent | Iterable<Uint8Array>): Promise<ObjectId> {
    if (Symbol.asyncIterator in content) {
      return this.blobStore.store(content as AsyncIterable<Uint8Array>);
    }
    return this.blobStore.store(iterableToAsync(content as Iterable<Uint8Array>));
  }

  async load(id: ObjectId): Promise<BlobContent | undefined> {
    if (!(await this.blobStore.has(id))) {
      return undefined;
    }
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

  size(id: ObjectId): Promise<number> {
    return this.blobStore.size(id);
  }
}

/**
 * Adapter that wraps old TreeStore to implement new Trees interface
 * @internal - For backward compatibility during migration
 */
class TreesLegacyAdapter implements Trees {
  constructor(private readonly treeStore: TreeStore) {}

  store(tree: TreeEntry[] | AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId> {
    return this.treeStore.storeTree(tree);
  }

  async load(id: ObjectId): Promise<AsyncIterable<TreeEntry> | undefined> {
    try {
      return this.treeStore.loadTree(id);
    } catch {
      return undefined;
    }
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
    return false; // TreeStore doesn't have a delete method
  }

  async *keys(): AsyncIterable<ObjectId> {
    // TreeStore doesn't have a keys method
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

/**
 * Adapter that wraps old CommitStore to implement new Commits interface
 * @internal - For backward compatibility during migration
 */
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
    return false; // CommitStore doesn't have a delete method
  }

  async *keys(): AsyncIterable<ObjectId> {
    // CommitStore doesn't have a keys method
  }

  getParents(commitId: ObjectId): Promise<ObjectId[]> {
    return this.commitStore.getParents(commitId);
  }

  getTree(commitId: ObjectId): Promise<ObjectId | undefined> {
    return this.commitStore.getTree(commitId);
  }

  walkAncestry(
    startId: ObjectId | ObjectId[],
    options?: import("../history/commits/commit-store.js").AncestryOptions,
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

/**
 * Adapter that wraps old TagStore to implement new Tags interface
 * @internal - For backward compatibility during migration
 */
class TagsLegacyAdapter implements Tags {
  constructor(private readonly tagStore: TagStore) {}

  store(tag: Tag): Promise<ObjectId> {
    return this.tagStore.storeTag(tag as AnnotatedTag);
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
    return false; // TagStore doesn't have a delete method
  }

  async *keys(): AsyncIterable<ObjectId> {
    // TagStore doesn't have a keys method
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

/**
 * Helper to convert sync iterable to async iterable
 */
async function* iterableToAsync(iter: Iterable<Uint8Array>): AsyncIterable<Uint8Array> {
  for (const item of iter) {
    yield item;
  }
}
