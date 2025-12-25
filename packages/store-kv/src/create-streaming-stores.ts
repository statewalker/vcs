/**
 * Factory function for creating Git-compatible streaming stores
 *
 * @deprecated Use createKvObjectStores from './object-storage/index.js' instead.
 * This file is kept for backwards compatibility.
 */

import type { GitStores } from "@webrun-vcs/core";
import type { KVStore } from "./kv-store.js";
import { createKvObjectStores } from "./object-storage/index.js";

/**
 * Options for creating KV-based streaming stores
 * @deprecated Use CreateKvObjectStoresOptions instead
 */
export interface StreamingKvStoresOptions {
  /** Key prefix for namespacing objects (default: "objects/") */
  prefix?: string;
}

/**
 * Create Git-compatible stores backed by key-value store.
 *
 * @deprecated Use createKvObjectStores from './object-storage/index.js' instead.
 *
 * @param kv Key-value store backend
 * @param options Optional configuration
 * @returns GitStores with all typed store implementations
 */
export function createStreamingKvStores(
  kv: KVStore,
  options?: StreamingKvStoresOptions,
): GitStores {
  const stores = createKvObjectStores({
    kv,
    prefix: options?.prefix ?? "objects/",
  });

  // Return GitStores-compatible interface
  return {
    objects: stores.objects,
    commits: stores.commits,
    trees: stores.trees,
    blobs: stores.blobs,
    tags: stores.tags,
  };
}

// Re-export new types for migration
export type { KvObjectStores } from "./object-storage/index.js";
export { createKvObjectStores } from "./object-storage/index.js";
