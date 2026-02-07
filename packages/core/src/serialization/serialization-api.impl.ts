/**
 * SerializationApi implementation
 *
 * Wraps existing pack and compression utilities to provide the SerializationApi interface.
 * Uses the History interface for accessing typed object stores.
 */

import { deflate, inflate } from "@statewalker/vcs-utils";
import { sha1 } from "@statewalker/vcs-utils/hash/sha1";
import { bytesToHex } from "@statewalker/vcs-utils/hash/utils";
import { PackObjectType, PackWriterStream, parsePackEntries } from "../backend/git/pack/index.js";
import type { ObjectId } from "../common/id/index.js";
import type { Blobs } from "../history/blobs/blobs.js";
import type { Commits } from "../history/commits/commits.js";
import type { History } from "../history/history.js";
import type { ObjectTypeString } from "../history/objects/object-types.js";
import type { Tags } from "../history/tags/tags.js";
import type { TreeEntry } from "../history/trees/tree-entry.js";
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
   * History stores for object access
   *
   * Only requires the object stores (blobs, trees, commits, tags).
   * Accepts a full History instance or just the required stores.
   */
  history: Pick<History, "blobs" | "trees" | "commits" | "tags">;

  /** Blob delta API for delta-aware import */
  blobDeltaApi?: BlobDeltaApi;
}

/**
 * Default implementation of SerializationApi
 *
 * Uses existing pack utilities and compression functions.
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
    this._blobs = config.history.blobs;
    this._trees = config.history.trees;
    this._commits = config.history.commits;
    this._tags = config.history.tags;
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
    // Try blobs first (uses separate storage, no ambiguity)
    if (await this._blobs.has(id)) {
      const content = await this._blobs.load(id);
      if (!content) throw new Error(`Blob not found: ${id}`);
      return { type: "blob", content };
    }

    // For shared-storage objects, use load() which checks the type header.
    // has() can't discriminate types when stores share a GitObjectStore.
    const commit = await this._commits.load(id);
    if (commit) {
      return { type: "commit", content: this.serializeCommit(id) };
    }

    const tree = await this._trees.load(id);
    if (tree) {
      return { type: "tree", content: this.serializeTree(id) };
    }

    const tag = await this._tags.load(id);
    if (tag) {
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
    // Try blobs first (uses separate storage, no ambiguity)
    if (await this._blobs.has(id)) {
      const blobContent = await this._blobs.load(id);
      if (!blobContent) throw new Error(`Blob not found: ${id}`);
      const chunks: Uint8Array[] = [];
      for await (const chunk of blobContent) {
        chunks.push(chunk);
      }
      return { type: PackObjectType.BLOB, content: concatBytes(chunks) };
    }

    // For shared-storage objects, use load() which checks the type header.
    // has() can't discriminate types when stores share a GitObjectStore.
    {
      const { serializeCommit } = await import("../history/commits/commit-format.js");
      const commit = await this._commits.load(id);
      if (commit) {
        return { type: PackObjectType.COMMIT, content: serializeCommit(commit) };
      }
    }

    {
      const { serializeTree } = await import("../history/trees/tree-format.js");
      const tree = await this._trees.load(id);
      if (tree) {
        const entries: TreeEntry[] = [];
        for await (const entry of tree) {
          entries.push(entry);
        }
        return { type: PackObjectType.TREE, content: serializeTree(entries) };
      }
    }

    {
      const { serializeTag } = await import("../history/tags/tag-format.js");
      const tag = await this._tags.load(id);
      if (tag) {
        return { type: PackObjectType.TAG, content: serializeTag(tag) };
      }
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
