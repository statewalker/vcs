import type { Delta } from "@statewalker/vcs-utils";
import {
  applyDelta,
  createDelta,
  createDeltaRanges,
  deserializeDeltaFromGit,
  slice,
} from "@statewalker/vcs-utils";
import { collect } from "@statewalker/vcs-utils/streams";
import type { RawStore } from "../binary/raw-store.js";
import { encodeObjectHeader } from "../../history/objects/object-header.js";
import type { ObjectTypeString } from "../../history/objects/object-types.js";
import { EMPTY_TREE_ID } from "../../history/trees/tree-format.js";
import type { BestDeltaResult } from "./delta-engine.js";
import type { DeltaChainDetails, DeltaStore, DeltaStoreUpdate } from "./delta-store.js";

/**
 * Empty tree content (Git header with zero content)
 *
 * The empty tree is a well-known Git constant that represents a tree
 * with no entries. Its SHA-1 hash is 4b825dc642cb6eb9a060e54bf8d69288fbee4904.
 * This is a virtual object that doesn't need to be stored.
 */
const EMPTY_TREE_CONTENT = encodeObjectHeader("tree", 0);

/**
 * Random access data source
 */
export type RandomAccessDataSource = (options?: {
  offset?: number;
  length?: number;
}) => AsyncIterable<Uint8Array>;

/**
 * Delta computation options
 */
export interface DeltaComputeOptions {
  /** Maximum compression ratio to accept (e.g., 0.75 = 25% savings minimum) */
  maxRatio?: number;
  /** Minimum size for deltification */
  minSize?: number;
}

/**
 * Delta computation result
 */
export interface DeltaComputeResult {
  /** Delta instructions */
  delta: Delta[];
  /** Compression ratio (delta size / original size) */
  ratio: number;
}

/**
 * Delta computation strategy
 */
const DEFAULT_MIN_SIZE = 50;

/**
 * Default maximum chain depth for delta chains
 */
const DEFAULT_MAX_CHAIN_DEPTH = 10;

/**
 * Default maximum ratio for delta to be considered beneficial
 */
const DEFAULT_MAX_RATIO = 0.75;

/**
 * Strategy for computing deltas between two objects.
 *
 * @param base Base object content
 * @param target Target object content
 * @param options Computation options
 * @returns Delta result or undefined if not beneficial
 */
export type DeltaComputeStrategy = (
  base: RandomAccessDataSource,
  target: RandomAccessDataSource,
  options?: DeltaComputeOptions,
) => Promise<DeltaComputeResult | undefined>;

export class RawStoreWithDelta implements RawStore {
  public readonly objects: RawStore;
  public readonly deltas: DeltaStore;
  public readonly computeDelta: DeltaComputeStrategy;
  /** Maximum compression ratio to accept (e.g., 0.75 = 25% savings minimum) */
  maxRatio?: number;
  /** Minimum size for deltification */
  minSize?: number;
  /** Maximum delta chain depth */
  private readonly maxChainDepth: number;
  /** Active batch update (for batching multiple deltify operations) */
  private batchUpdate: DeltaStoreUpdate | null = null;

  constructor({
    objects,
    deltas,
    computeDelta = defaultComputeDelta,
    maxRatio,
    minSize,
    maxChainDepth,
  }: {
    objects: RawStore;
    deltas: DeltaStore;
    computeDelta?: DeltaComputeStrategy;
    /** Maximum compression ratio to accept (e.g., 0.75 = 25% savings minimum) */
    maxRatio?: number;
    /** Minimum size for deltification */
    minSize?: number;
    maxChainDepth?: number;
  }) {
    this.objects = objects;
    this.deltas = deltas;
    this.computeDelta = computeDelta;
    this.maxRatio = maxRatio ?? DEFAULT_MAX_RATIO;
    this.minSize = minSize;
    this.maxChainDepth = maxChainDepth ?? DEFAULT_MAX_CHAIN_DEPTH;
    if (!this.computeDelta) {
      throw new Error("No compute strategy configured");
    }
  }

  /**
   * Start a batch operation for deltification
   *
   * When a batch is active, all deltify() operations will be collected
   * into a single pack file. Call endBatch() to commit all deltas.
   *
   * This enables GCController to create proper pack files with valid
   * cross-references between objects in the same pack.
   *
   * @throws Error if a batch is already in progress
   *
   * @example
   * ```typescript
   * store.startBatch();
   * try {
   *   await store.deltify(id1, candidates);
   *   await store.deltify(id2, candidates);
   *   await store.endBatch(); // Creates single pack with all deltas
   * } catch (e) {
   *   store.cancelBatch();
   *   throw e;
   * }
   * ```
   */
  startBatch(): void {
    if (this.batchUpdate) {
      throw new Error("Batch already in progress");
    }
    this.batchUpdate = this.deltas.startUpdate();
  }

  /**
   * Commit all pending deltas in the current batch
   *
   * Creates a single pack file containing all deltas added since startBatch().
   * This ensures proper cross-references between deltas in the same pack.
   *
   * @throws Error if no batch is in progress
   */
  async endBatch(): Promise<void> {
    if (!this.batchUpdate) {
      throw new Error("No batch in progress");
    }
    const update = this.batchUpdate;
    this.batchUpdate = null;
    await update.close();
  }

  /**
   * Cancel the current batch without committing
   *
   * Discards all pending deltas. Use this in error handling.
   */
  cancelBatch(): void {
    this.batchUpdate = null;
  }

  /**
   * Get the current batch update handle
   *
   * Returns the DeltaStoreUpdate for direct object storage during batch operations.
   * This allows adding full objects to the pack before deltification.
   *
   * @returns The batch update handle, or null if no batch is in progress
   */
  getBatchUpdate(): DeltaStoreUpdate | null {
    return this.batchUpdate;
  }

  /**
   * Check if a batch is currently in progress
   */
  isBatchInProgress(): boolean {
    return this.batchUpdate !== null;
  }

  async *keys(): AsyncGenerator<string> {
    const seen = new Set<string>();

    for await (const key of this.objects.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        yield key;
      }
    }

    for await (const info of this.deltas.listDeltas()) {
      if (!seen.has(info.targetKey)) {
        seen.add(info.targetKey);
        yield info.targetKey;
      }
    }
  }

  async size(id: string): Promise<number> {
    // Handle well-known empty tree (virtual object)
    if (id === EMPTY_TREE_ID) {
      return 0;
    }

    // Check deltas first (returns originalSize for resolved content)
    const chainInfo = await this.deltas.getDeltaChainInfo(id);
    if (chainInfo) {
      return chainInfo.originalSize;
    }

    // Check loose objects
    if (await this.objects.has(id)) {
      return this.objects.size(id);
    }

    // Check pack files for full objects (not deltas)
    if (this.deltas.loadObject) {
      const content = await this.deltas.loadObject(id);
      if (content) {
        return content.length;
      }
    }

    throw new Error(`Object not found: ${id}`);
  }

  async has(id: string): Promise<boolean> {
    // Handle well-known empty tree (virtual object)
    if (id === EMPTY_TREE_ID) {
      return true;
    }

    if (await this.deltas.isDelta(id)) {
      return true;
    }
    if (await this.objects.has(id)) {
      return true;
    }
    // Check pack files for full objects (not deltas)
    if (this.deltas.hasObject) {
      return this.deltas.hasObject(id);
    }
    return false;
  }

  async store(
    key: string,
    content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): Promise<number> {
    return this.objects.store(key, content);
  }

  /**
   * Load object content (streaming, resolves delta chains)
   *
   * Returns content with Git header stripped.
   * Transparently resolves delta chains if object is stored as delta.
   * Also loads full objects from pack files if not in loose storage.
   *
   * @param id Object ID
   * @throws Error if object not found
   */
  async *load(
    id: string,
    options?: { offset?: number; length?: number },
  ): AsyncGenerator<Uint8Array> {
    // Handle well-known empty tree (virtual object)
    if (id === EMPTY_TREE_ID) {
      // Return the empty tree header "tree 0\0"
      if (options?.offset !== undefined || options?.length !== undefined) {
        const offset = options.offset ?? 0;
        const length = options.length ?? EMPTY_TREE_CONTENT.length - offset;
        yield EMPTY_TREE_CONTENT.subarray(offset, offset + length);
      } else {
        yield EMPTY_TREE_CONTENT;
      }
      return;
    }

    // Check pack files first (handles both full objects AND deltas)
    // The pack reader resolves deltas internally using Git's binary format
    // This takes precedence because pack delta resolution is more efficient
    // If loading fails (e.g., REF_DELTA with base in loose storage), fall back to other methods
    if (this.deltas.loadObject) {
      try {
        const content = await this.deltas.loadObject(id);
        if (content) {
          if (options?.offset !== undefined || options?.length !== undefined) {
            const offset = options.offset ?? 0;
            const length = options.length ?? content.length - offset;
            yield content.subarray(offset, offset + length);
          } else {
            yield content;
          }
          return;
        }
      } catch {
        // Pack loading failed (e.g., REF_DELTA base not in pack)
        // Fall through to try other loading methods
      }
    }

    // Check if it's a delta (internal format, not pack)
    // This handles non-pack delta stores (e.g., SQL-based, mock stores)
    if (await this.deltas.isDelta(id)) {
      const content = this.resolveDeltaChain(id);
      if (options?.offset !== undefined || options?.length !== undefined) {
        yield* slice(content, options.offset, options.length);
      } else {
        yield* content;
      }
      return;
    }

    // Check loose objects
    if (await this.objects.has(id)) {
      yield* this.objects.load(id, options);
      return;
    }

    // Object not found anywhere
    throw new Error(`Object not found: ${id}`);
  }

  /**
   * Delete object
   */
  async delete(id: string): Promise<boolean> {
    let deleted = false;

    if (await this.deltas.isDelta(id)) {
      deleted = await this.deltas.removeDelta(id);
    }

    if (await this.objects.has(id)) {
      deleted = (await this.objects.delete(id)) || deleted;
    }

    return deleted;
  }

  private getSourceStream(id: string): RandomAccessDataSource {
    const that = this;
    return async function* (options?: { offset?: number; length?: number }) {
      const iterator = that.load(id, options);
      if (options?.offset !== undefined || options?.length !== undefined) {
        yield* slice(iterator, options.offset ?? 0, options.length ?? Infinity);
      } else {
        yield* iterator;
      }
    };
  }

  isDelta(id: string): Promise<boolean> {
    return this.deltas.isDelta(id);
  }

  getDeltaChainInfo(targetKey: string): Promise<DeltaChainDetails | undefined> {
    return this.deltas.getDeltaChainInfo(targetKey);
  }

  /**
   * Convert delta back to full content
   */
  async undeltify(id: string): Promise<void> {
    if (!(await this.deltas.isDelta(id))) {
      return;
    }

    // Load full content through delta resolution
    const content = this.resolveDeltaChain(id);

    // Store as loose object
    await this.objects.store(id, content);

    // Remove delta entry
    await this.deltas.removeDelta(id);
  }

  /**
   * Deltify with explicit candidates
   */
  async deltify(
    targetId: string,
    candidateIds: string[],
    options?: DeltaComputeOptions,
  ): Promise<boolean> {
    if (candidateIds.length === 0) {
      return false;
    }

    // Load target content
    const targetContent = this.getSourceStream(targetId);
    if (!targetContent) {
      return false;
    }

    const computeOptions = {
      maxRatio: this.maxRatio,
      ...options,
    };

    let bestResult: {
      baseId: string;
      delta: Delta[];
      ratio: number;
    } | null = null;

    for (const candidateId of candidateIds) {
      // Skip if would create deep chain
      const chainInfo = await this.deltas.getDeltaChainInfo(candidateId);
      if (chainInfo && chainInfo.depth >= this.maxChainDepth - 1) {
        continue;
      }

      const baseContent = this.getSourceStream(candidateId);
      if (!baseContent) {
        continue;
      }

      const result = await this.computeDelta(baseContent, targetContent, computeOptions);

      if (result && (!bestResult || result.ratio < bestResult.ratio)) {
        bestResult = {
          baseId: candidateId,
          delta: result.delta,
          ratio: result.ratio,
        };
      }
    }

    if (!bestResult) {
      return false;
    }

    // Store delta - use batch update if active, otherwise create individual update
    if (this.batchUpdate) {
      // Batch mode: add to existing update (will be committed with endBatch())
      await this.batchUpdate.storeDelta(
        {
          targetKey: targetId,
          baseKey: bestResult.baseId,
        },
        bestResult.delta,
      );
    } else {
      // Individual mode: create and close update immediately
      const update = this.deltas.startUpdate();
      await update.storeDelta(
        {
          targetKey: targetId,
          baseKey: bestResult.baseId,
        },
        bestResult.delta,
      );
      await update.close();
    }

    return true;
  }

  /**
   * Store a pre-computed delta result from DeltaEngine
   *
   * This method stores a delta that was already computed externally
   * (e.g., by DeltaEngine.findBestDelta). The delta is in Git binary
   * format and will be converted to Delta[] for storage.
   *
   * @param targetId Target object ID
   * @param result Pre-computed delta result from DeltaEngine
   */
  async storeDeltaResult(targetId: string, result: BestDeltaResult): Promise<void> {
    // Convert Git binary delta to Delta[] instructions
    const delta = deserializeDeltaFromGit(result.delta);

    // Store delta - use batch update if active, otherwise create individual update
    if (this.batchUpdate) {
      // Batch mode: add to existing update (will be committed with endBatch())
      await this.batchUpdate.storeDelta(
        {
          targetKey: targetId,
          baseKey: result.baseId,
        },
        delta,
      );
    } else {
      // Individual mode: create and close update immediately
      const update = this.deltas.startUpdate();
      await update.storeDelta(
        {
          targetKey: targetId,
          baseKey: result.baseId,
        },
        delta,
      );
      await update.close();
    }
  }

  // ---------------------------------------------------------
  // FIXME: use random access streams in the code below
  // ---------------------------------------------------------

  /**
   * Resolve a delta chain and stream the result
   *
   * For non-delta objects, streams directly from raw storage.
   * For delta objects, resolves the chain and yields the reconstructed content.
   *
   * Note: Delta resolution requires loading base content into memory to apply
   * the delta instructions. The result is then yielded as a single chunk.
   * For very large objects, consider streaming from raw storage directly.
   *
   * @param objectId Object ID to resolve
   * @param raw Raw storage for base objects
   * @param delta Delta storage for delta relationships
   * @throws Error if object not found or delta chain is broken
   */
  private async *resolveDeltaChain(objectId: string): AsyncGenerator<Uint8Array> {
    // Check if it's a delta
    const storedDelta = await this.deltas.loadDelta(objectId);

    if (!storedDelta) {
      // Not a delta - stream directly from raw storage or pack files
      if (await this.objects.has(objectId)) {
        yield* this.objects.load(objectId);
        return;
      }

      // Check pack files for full objects (not deltas)
      if (this.deltas.loadObject) {
        const content = await this.deltas.loadObject(objectId);
        if (content) {
          yield content;
          return;
        }
      }

      throw new Error(`Object not found: ${objectId}`);
    }

    // Resolve base content recursively
    const baseContent = await collectBytes(this.resolveDeltaChain(storedDelta.baseKey));

    // Extract type from base content header (deltas are between objects of same type)
    // and strip header before applying delta
    const { typeStr, content: headerlessBase } = extractGitHeaderInfo(baseContent);

    // Apply delta to reconstruct headerless content (applyDelta returns sync generator)
    const deltaResult = collectSyncGenerator(applyDelta(headerlessBase, storedDelta.delta));

    // Reconstruct Git header with same type and new size
    // This ensures load() returns content WITH headers as expected
    if (typeStr) {
      yield encodeObjectHeader(typeStr as ObjectTypeString, deltaResult.length);
    }
    yield deltaResult;
  }
}

/**
 * Rolling Hash Delta Computation Strategy
 *
 * Uses rolling hash algorithm to find copy regions between base and target.
 * Produces format-agnostic Delta[] instructions that can be serialized
 * to Git format, stored in SQL, etc.
 *
 * Git headers ("type size\0") are automatically stripped before delta computation
 * to ensure deltas work correctly with pack files which store headerless content.
 */
export async function defaultComputeDelta(
  base: RandomAccessDataSource,
  target: RandomAccessDataSource,
  options?: DeltaComputeOptions,
): Promise<DeltaComputeResult | undefined> {
  const minSize = options?.minSize ?? DEFAULT_MIN_SIZE;
  const maxRatio = options?.maxRatio ?? DEFAULT_MAX_RATIO;

  // Strip Git headers before delta computation
  // Pack files store content WITHOUT headers, so deltas must be computed on headerless content
  const baseBuffer = await stripGitHeaderAndCollect(base());
  const targetBuffer = await stripGitHeaderAndCollect(target());

  // Skip small objects
  if (targetBuffer.length < minSize) {
    return undefined;
  }

  // Compute delta ranges using rolling hash
  const ranges = createDeltaRanges(baseBuffer, targetBuffer);

  // Convert ranges to Delta[] instructions
  const delta = [...createDelta(baseBuffer, targetBuffer, ranges)];

  // Estimate size and check if delta is beneficial
  const estimatedSize = estimateDeltaSize(delta);
  const ratio = estimatedSize / targetBuffer.length;

  if (ratio >= maxRatio) {
    return undefined;
  }

  return {
    delta,
    ratio,
  };
}

/**
 * Extracted Git header information
 */
interface GitHeaderInfo {
  /** Object type string (blob, tree, commit, tag) */
  typeStr: string;
  /** Content without Git header */
  content: Uint8Array;
}

/**
 * Extract Git header info and strip header from buffer
 *
 * Git objects have format "type size\0content". This function extracts
 * the type string and returns content without the header.
 *
 * If no Git header is found (no null byte within first 32 bytes),
 * returns the content as-is with empty type string.
 *
 * @returns Object with typeStr and headerless content
 */
function extractGitHeaderInfo(buffer: Uint8Array): GitHeaderInfo {
  // Look for null byte in first 32 bytes (max header length)
  const maxHeaderLen = Math.min(32, buffer.length);
  for (let i = 0; i < maxHeaderLen; i++) {
    if (buffer[i] === 0) {
      // Found null byte - parse header "type size"
      const headerStr = new TextDecoder().decode(buffer.subarray(0, i));
      const spaceIdx = headerStr.indexOf(" ");
      const typeStr = spaceIdx > 0 ? headerStr.substring(0, spaceIdx) : headerStr;
      return {
        typeStr,
        content: buffer.subarray(i + 1),
      };
    }
  }
  // No header found - return as-is
  return { typeStr: "", content: buffer };
}

/**
 * Strip Git header from buffer
 *
 * Git objects have format "type size\0content". This function removes
 * the header and returns only the content bytes.
 *
 * If no Git header is found (no null byte within first 32 bytes),
 * returns the content as-is (for raw content without headers).
 */
function stripGitHeader(buffer: Uint8Array): Uint8Array {
  return extractGitHeaderInfo(buffer).content;
}

/**
 * Collect stream and strip Git header
 */
async function stripGitHeaderAndCollect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const buffer = await collect(stream);
  return stripGitHeader(buffer);
}

/**
 * Estimate serialized size of delta
 */
export function estimateDeltaSize(delta: Iterable<Delta>): number {
  let size = 0;
  for (const d of delta) {
    switch (d.type) {
      case "start":
        // varint for target length (max 5 bytes for 32-bit int)
        size += 5;
        break;
      case "copy":
        // Git format: 1 cmd byte + up to 4 offset bytes + up to 3 size bytes
        size += 1 + 4 + 3;
        break;
      case "insert":
        // Git format: 1 length byte (max 127) + data bytes
        // For larger inserts, multiple instructions are needed
        size += Math.ceil(d.data.length / 127) + d.data.length;
        break;
      case "finish":
        // Checksum (4 bytes)
        size += 4;
        break;
      default:
        // Unknown delta type - ignore
        break;
    }
  }
  return size;
}

/**
 * Collect sync generator into single Uint8Array
 */
function collectSyncGenerator(gen: Generator<Uint8Array>): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for (const chunk of gen) {
    chunks.push(chunk);
    totalLength += chunk.length;
  }

  if (chunks.length === 0) {
    return new Uint8Array(0);
  }

  if (chunks.length === 1) {
    return chunks[0];
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Collect async iterable into single Uint8Array
 */
async function collectBytes(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for await (const chunk of stream) {
    chunks.push(chunk);
    totalLength += chunk.length;
  }

  if (chunks.length === 0) {
    return new Uint8Array(0);
  }

  if (chunks.length === 1) {
    return chunks[0];
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}
