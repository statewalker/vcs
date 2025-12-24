import type { Delta } from "@webrun-vcs/utils";
import { applyDelta, createDelta, createDeltaRanges, slice } from "@webrun-vcs/utils";
import type { RawStore } from "../binary/raw-store.js";
import type { DeltaChainDetails, DeltaStore } from "./delta-store.js";

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
    const chainInfo = await this.deltas.getDeltaChainInfo(id);
    if (chainInfo) {
      return chainInfo.originalSize;
    }
    return this.objects.size(id);
  }

  async has(id: string): Promise<boolean> {
    if (await this.deltas.isDelta(id)) {
      return true;
    }
    return this.objects.has(id);
  }

  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<number> {
    return this.objects.store(key, content);
  }

  /**
   * Load object content (streaming, resolves delta chains)
   *
   * Returns content with Git header stripped.
   * Transparently resolves delta chains if object is stored as delta.
   *
   * @param id Object ID
   * @throws Error if object not found
   */
  async *load(
    id: string,
    options?: { offset?: number; length?: number },
  ): AsyncGenerator<Uint8Array> {
    // Check if it's a delta
    if (await this.deltas.isDelta(id)) {
      // Resolve delta chain (strips header internally)
      const content = this.resolveDeltaChain(id);
      if (options?.offset !== undefined || options?.length !== undefined) {
        yield* slice(content, options.offset, options.length);
      } else {
        yield* content;
      }
    } else {
      yield* this.objects.load(id, options);
    }
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

    await this.deltas.storeDelta(
      {
        targetKey: targetId,
        baseKey: bestResult.baseId,
      },
      bestResult.delta,
    );

    return true;
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
      // Not a delta - stream directly from raw storage
      if (!(await this.objects.has(objectId))) {
        throw new Error(`Object not found: ${objectId}`);
      }
      yield* this.objects.load(objectId);
      return;
    }

    // Resolve base content recursively
    const baseContent = await collectBytes(this.resolveDeltaChain(storedDelta.baseKey));

    // Apply delta to reconstruct content (applyDelta returns a generator)
    yield* applyDelta(baseContent, storedDelta.delta);
  }
}

/**
 * Rolling Hash Delta Computation Strategy
 *
 * Uses rolling hash algorithm to find copy regions between base and target.
 * Produces format-agnostic Delta[] instructions that can be serialized
 * to Git format, stored in SQL, etc.
 */
export async function defaultComputeDelta(
  base: RandomAccessDataSource,
  target: RandomAccessDataSource,
  options?: DeltaComputeOptions,
): Promise<DeltaComputeResult | undefined> {
  const minSize = options?.minSize ?? DEFAULT_MIN_SIZE;
  const maxRatio = options?.maxRatio ?? DEFAULT_MAX_RATIO;

  const baseBuffer = await collectBytes(base());
  const targetBuffer = await collectBytes(target());

  // Skip small objects
  if (target.length < minSize) {
    return undefined;
  }

  // Compute delta ranges using rolling hash
  const ranges = createDeltaRanges(baseBuffer, targetBuffer);

  // Convert ranges to Delta[] instructions
  const delta = [...createDelta(baseBuffer, targetBuffer, ranges)];

  // Estimate size and check if delta is beneficial
  const estimatedSize = estimateDeltaSize(delta);
  const ratio = estimatedSize / target.length;

  if (ratio >= maxRatio) {
    return undefined;
  }

  return {
    delta,
    ratio,
  };
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
