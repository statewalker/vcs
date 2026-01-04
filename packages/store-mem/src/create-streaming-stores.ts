/**
 * Factory function for creating Git-compatible streaming stores
 *
 * @deprecated Use createMemoryObjectStores from './object-storage/index.js' instead.
 * This file is kept for backwards compatibility.
 */

import type { GitStores } from "@statewalker/vcs-core";
import { createMemoryObjectStores } from "./object-storage/index.js";

/**
 * Create Git-compatible stores backed by memory.
 *
 * @deprecated Use createMemoryObjectStores from './object-storage/index.js' instead.
 *
 * @returns GitStores with all typed store implementations
 */
export function createStreamingMemoryStores(): GitStores {
  const stores = createMemoryObjectStores();

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
export type { MemoryObjectStores } from "./object-storage/index.js";
export { createMemoryObjectStores } from "./object-storage/index.js";
