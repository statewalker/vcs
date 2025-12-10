import type { Delta } from "@webrun-vcs/utils";
import type { ObjectId } from "./types.js";

/**
 * Stored delta information
 *
 * Returns delta as Delta[] instructions, regardless of how the backend
 * stores them internally (Git binary format, SQL rows, etc.).
 */
export interface StoredDelta {
  /** Target object ID */
  targetId: ObjectId;
  /** Base object ID */
  baseId: ObjectId;
  /** Delta instructions (format-agnostic) */
  delta: Delta[];
  /** Compression ratio achieved */
  ratio: number;
}

/**
 * Detailed delta chain information
 *
 * More comprehensive than DeltaChainInfo from delta-object-storage.ts,
 * includes full chain traversal details.
 */
export interface DeltaChainDetails {
  /** Base object ID (root of chain) */
  baseId: ObjectId;
  /** Chain depth (1 = direct delta, 2+ = chained) */
  depth: number;
  /** Total original size of all objects in chain */
  originalSize: number;
  /** Total compressed size */
  compressedSize: number;
  /** Object IDs in chain order (target -> base) */
  chain: ObjectId[];
}

/**
 * Backend statistics
 */
export interface DeltaChainStoreStats {
  /** Total number of delta objects */
  deltaCount: number;
  /** Total number of base (non-delta) objects */
  baseCount: number;
  /** Average chain depth */
  averageChainDepth: number;
  /** Maximum chain depth */
  maxChainDepth: number;
  /** Total storage size */
  totalSize: number;
  /** Backend-specific stats */
  extra?: Record<string, unknown>;
}

/**
 * Backend for delta storage
 *
 * Implementations store delta relationships and data in various formats:
 * - Git pack files (file-based) - serializes Delta[] to Git binary format
 * - SQL tables - stores Delta[] as JSON or individual rows
 * - Cloud storage - serializes to any format
 *
 * All backends accept and return Delta[] instructions, handling
 * serialization internally.
 */
export interface DeltaChainStore {
  /**
   * Unique identifier for this backend
   */
  readonly name: string;

  /**
   * Store a delta relationship
   *
   * The backend serializes Delta[] to its native format internally.
   *
   * @param targetId Object stored as delta
   * @param baseId Base object
   * @param delta Delta instructions (format-agnostic)
   * @returns True if stored successfully
   */
  storeDelta(targetId: ObjectId, baseId: ObjectId, delta: Delta[]): Promise<boolean>;

  /**
   * Load delta for an object
   *
   * The backend deserializes from its native format to Delta[] internally.
   *
   * @param id Target object ID
   * @returns Stored delta with Delta[] instructions, or undefined if not a delta
   */
  loadDelta(id: ObjectId): Promise<StoredDelta | undefined>;

  /**
   * Check if object is stored as delta
   */
  isDelta(id: ObjectId): Promise<boolean>;

  /**
   * Check if object exists in backend (as base or delta)
   */
  has(id: ObjectId): Promise<boolean>;

  /**
   * Load full object content (resolving delta chain)
   *
   * This is the primary read method - it handles delta resolution.
   *
   * @param id Object ID
   * @returns Full object content or undefined
   */
  loadObject(id: ObjectId): Promise<Uint8Array | undefined>;

  /**
   * Remove delta relationship (convert to base or delete)
   *
   * @param id Target object ID
   * @param keepAsBase If true, store full content; if false, remove entirely
   * @returns True if removed
   */
  removeDelta(id: ObjectId, keepAsBase?: boolean): Promise<boolean>;

  /**
   * Get delta chain info for an object
   */
  getDeltaChainInfo(id: ObjectId): Promise<DeltaChainDetails | undefined>;

  /**
   * List all objects (both base and delta)
   */
  listObjects(): AsyncIterable<ObjectId>;

  /**
   * List only delta objects
   */
  listDeltas(): AsyncIterable<{ targetId: ObjectId; baseId: ObjectId }>;

  /**
   * Get backend statistics
   */
  getStats(): Promise<DeltaChainStoreStats>;

  /**
   * Flush pending writes (for backends with write buffering)
   */
  flush(): Promise<void>;

  /**
   * Close backend and release resources
   */
  close(): Promise<void>;

  /**
   * Refresh backend state (re-scan files, etc.)
   */
  refresh(): Promise<void>;
}
