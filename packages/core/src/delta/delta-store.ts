import type { Delta } from "@webrun-vcs/utils";

/**
 * Base delta relationship information
 */
export interface DeltaInfo {
  /** Base object key (source for delta) */
  baseKey: string;
  /** Target object key (result of applying delta) */
  targetKey: string;
}

/**
 * Stored delta with instructions
 *
 * Returns delta as Delta[] instructions, regardless of how the backend
 * stores them internally (Git binary format, SQL rows, etc.).
 */
export interface StoredDelta extends DeltaInfo {
  /** Delta instructions (format-agnostic) */
  delta: Delta[];
  /** Compression ratio achieved (compressed/original) */
  ratio: number;
}

/**
 * Detailed delta chain information
 */
export interface DeltaChainDetails extends DeltaInfo {
  /** Chain depth (1 = direct delta, 2+ = chained) */
  depth: number;
  /** Original uncompressed size */
  originalSize: number;
  /** Compressed storage size */
  compressedSize: number;
  /** Object keys in chain order (target -> base) */
  chain: string[];
}

/**
 * Alias for backwards compatibility
 */
export type DeltaChainInfo = DeltaChainDetails;

/**
 * Delta compression storage interface
 *
 * Implementations store delta relationships and data in various formats:
 * - Git pack files (file-based) - serializes Delta[] to Git binary format
 * - SQL tables - stores Delta[] as JSON or individual rows
 * - In-memory maps - stores Delta[] directly
 *
 * All backends accept and return Delta[] instructions, handling
 * serialization internally.
 */
export interface DeltaStore {
  /**
   * Store a delta relationship
   *
   * The backend serializes Delta[] to its native format internally.
   *
   * @param info Delta relationship info (baseKey, targetKey)
   * @param delta Delta instructions (format-agnostic)
   * @returns True if stored successfully
   */
  storeDelta(info: DeltaInfo, delta: Delta[]): Promise<number>;

  /**
   * Load delta for an object
   *
   * The backend deserializes from its native format to Delta[] internally.
   *
   * @param targetKey Target object key
   * @returns Stored delta with Delta[] instructions, or undefined if not a delta
   */
  loadDelta(targetKey: string): Promise<StoredDelta | undefined>;

  /**
   * Check if object is stored as delta
   *
   * @param targetKey Target object key
   * @returns True if object is stored as a delta
   */
  isDelta(targetKey: string): Promise<boolean>;

  /**
   * Remove delta relationship
   *
   * @param targetKey Target object key
   * @param keepAsBase If true, store full content; if false, remove entirely
   * @returns True if removed
   */
  removeDelta(targetKey: string, keepAsBase?: boolean): Promise<boolean>;

  /**
   * Get delta chain info for an object
   *
   * @param targetKey Target object key
   * @returns Chain details or undefined if not a delta
   */
  getDeltaChainInfo(targetKey: string): Promise<DeltaChainDetails | undefined>;

  /**
   * List all delta relationships
   *
   * @returns Async iterable of delta info (baseKey, targetKey)
   */
  listDeltas(): AsyncIterable<DeltaInfo>;
}
