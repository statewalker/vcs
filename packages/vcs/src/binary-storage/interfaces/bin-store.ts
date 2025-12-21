import type { DeltaStore } from "./delta-store.js";
import type { RawStore } from "./raw-store.js";

/**
 * Composite binary storage interface
 *
 * Combines RawStore (direct content storage) with DeltaStore
 * (delta-compressed storage) into a unified storage layer.
 *
 * This is the primary interface for low-level binary storage,
 * providing both direct and delta-compressed access patterns.
 */
export interface BinStore {
  /**
   * Backend identifier
   */
  readonly name: string;

  /**
   * Raw content storage
   *
   * For storing and retrieving content directly by key.
   * Use for base objects and when delta compression is not needed.
   */
  readonly raw: RawStore;

  /**
   * Delta compression storage
   *
   * For storing and retrieving delta-compressed content.
   * Use when objects share significant content with existing objects.
   */
  readonly delta: DeltaStore;

  /**
   * Flush pending writes
   *
   * Some backends buffer writes for performance. Call flush()
   * to ensure all pending writes are persisted.
   */
  flush(): Promise<void>;

  /**
   * Close backend and release resources
   *
   * After close(), the store should not be used.
   */
  close(): Promise<void>;

  /**
   * Refresh backend state
   *
   * Re-scan underlying storage for changes made externally.
   * Useful when multiple processes access the same storage.
   */
  refresh(): Promise<void>;
}
