/**
 * Factory function for creating Git-compatible streaming stores
 *
 * Creates stores using the new streaming architecture that produces
 * Git-compatible object IDs.
 */

import type { GitStores } from "@webrun-vcs/vcs";
import { createStreamingStores, MemoryTempStore } from "@webrun-vcs/vcs";
import { KvRawStorage } from "./kv-raw-storage.js";
import type { KVStore } from "./kv-store.js";

/**
 * Options for creating KV-based streaming stores
 */
export interface StreamingKvStoresOptions {
  /** Key prefix for namespacing objects (default: "objects/") */
  prefix?: string;
}

/**
 * Create Git-compatible stores backed by key-value store.
 *
 * Uses the streaming architecture with proper Git header format
 * for SHA-1 compatibility.
 *
 * @param kv Key-value store backend
 * @param options Optional configuration
 * @returns GitStores with all typed store implementations
 */
export function createStreamingKvStores(
  kv: KVStore,
  options?: StreamingKvStoresOptions,
): GitStores {
  const prefix = options?.prefix ?? "objects/";

  const storage = new KvRawStorage(kv, prefix);
  const temp = new MemoryTempStore();

  return createStreamingStores({ storage, temp });
}
