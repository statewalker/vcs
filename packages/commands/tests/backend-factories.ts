/**
 * Backend factory functions for multi-backend testing
 *
 * Provides factory functions to create WorkingCopy instances with different backends.
 * Used for testing commands across Memory, SQL, and other storage implementations.
 *
 * Migration:
 * - Old: Use GitStoreFactory and GitStoreTestContext with `store` property
 * - New: Use WorkingCopyFactory and WorkingCopyTestContext with `workingCopy` property
 *
 * @see GitStore for backward compatibility (deprecated)
 * @see WorkingCopy for the new architecture
 */

import type { WorkingCopy } from "@statewalker/vcs-core";
import { MemoryWorkingCopy } from "@statewalker/vcs-core";
import {
  createMemoryObjectStores,
  MemoryRefStore,
  MemoryStagingStore,
} from "@statewalker/vcs-store-mem";
import {
  createSqlObjectStores,
  initializeSchema,
  SQLRefStore,
  SQLStagingStore,
} from "@statewalker/vcs-store-sql";
import { SqlJsAdapter } from "@statewalker/vcs-store-sql/adapters/sql-js";
import { setCompressionUtils } from "@statewalker/vcs-utils";
import { createNodeCompression } from "@statewalker/vcs-utils-node/compression";

import type { GitStore } from "../src/index.js";

import { createMockWorktreeStore } from "./mock-worktree-store.js";
import { createSimpleHistoryStore } from "./simple-history-store.js";

// Enable Node.js compression for SQL backend
setCompressionUtils(createNodeCompression());

/**
 * Test context for WorkingCopy tests (new architecture)
 */
export interface WorkingCopyTestContext {
  /** The WorkingCopy instance (primary interface) */
  workingCopy: WorkingCopy;
  /**
   * @deprecated Use workingCopy instead. Provided for backward compatibility.
   */
  store: GitStore;
  /** Cleanup function to call after test */
  cleanup?: () => Promise<void>;
}

/**
 * @deprecated Use WorkingCopyTestContext instead
 */
export interface GitStoreTestContext {
  store: GitStore;
  cleanup?: () => Promise<void>;
}

/**
 * Factory function to create WorkingCopy instances for testing
 */
export type WorkingCopyFactory = () => Promise<WorkingCopyTestContext>;

/**
 * @deprecated Use WorkingCopyFactory instead
 */
export type GitStoreFactory = () => Promise<GitStoreTestContext>;

/**
 * Memory backend factory (default, fastest)
 *
 * Creates both WorkingCopy (new) and GitStore (deprecated) for compatibility.
 */
export const memoryFactory: WorkingCopyFactory = async () => {
  const stores = createMemoryObjectStores();
  const refs = new MemoryRefStore();
  const staging = new MemoryStagingStore();

  // Create legacy GitStore for backward compatibility
  const store: GitStore = {
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    refs,
    staging,
    tags: stores.tags,
  };

  // Create HistoryStore wrapper
  const repository = createSimpleHistoryStore({
    objects: stores.objects,
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    tags: stores.tags,
    refs,
  });

  // Create mock WorktreeStore
  const worktree = createMockWorktreeStore();

  // Create WorkingCopy
  const workingCopy = new MemoryWorkingCopy({
    repository,
    worktree,
    staging,
  });

  return { workingCopy, store };
};

/**
 * SQL backend factory (persistent, uses sql.js in-memory)
 *
 * Creates both WorkingCopy (new) and GitStore (deprecated) for compatibility.
 */
export const sqlFactory: WorkingCopyFactory = async () => {
  const db = await SqlJsAdapter.create();
  await initializeSchema(db);
  const stores = createSqlObjectStores({ db });
  const refs = new SQLRefStore(db);
  const staging = new SQLStagingStore(db);

  // Create legacy GitStore for backward compatibility
  const store: GitStore = {
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    refs,
    staging,
    tags: stores.tags,
  };

  // Create HistoryStore wrapper
  const repository = createSimpleHistoryStore({
    objects: stores.objects,
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    tags: stores.tags,
    refs,
  });

  // Create mock WorktreeStore
  const worktree = createMockWorktreeStore();

  // Create WorkingCopy
  const workingCopy = new MemoryWorkingCopy({
    repository,
    worktree,
    staging,
  });

  return {
    workingCopy,
    store,
    cleanup: async () => {
      await db.close();
    },
  };
};

/**
 * All available backends for cross-backend testing
 */
export const backends: Array<{ name: string; factory: WorkingCopyFactory }> = [
  { name: "Memory", factory: memoryFactory },
  { name: "SQL", factory: sqlFactory },
];

/**
 * Default backend for single-backend tests
 */
export const defaultFactory = memoryFactory;
