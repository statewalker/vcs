/**
 * Backend factory functions for multi-backend testing
 *
 * Provides factory functions to create GitStore instances with different backends.
 * Used for testing commands across Memory, SQL, and other storage implementations.
 */

import {
  createMemoryObjectStores,
  MemoryRefStore,
  MemoryStagingStore,
} from "@webrun-vcs/store-mem";
import {
  createSqlObjectStores,
  initializeSchema,
  SQLRefStore,
  SQLStagingStore,
} from "@webrun-vcs/store-sql";
import { SqlJsAdapter } from "@webrun-vcs/store-sql/adapters/sql-js";
import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";

import type { GitStore } from "../src/index.js";

// Enable Node.js compression for SQL backend
setCompression(createNodeCompression());

/**
 * Test context for GitStore tests
 */
export interface GitStoreTestContext {
  store: GitStore;
  cleanup?: () => Promise<void>;
}

/**
 * Factory function to create GitStore instances for testing
 */
export type GitStoreFactory = () => Promise<GitStoreTestContext>;

/**
 * Memory backend factory (default, fastest)
 */
export const memoryFactory: GitStoreFactory = async () => {
  const stores = createMemoryObjectStores();
  const store: GitStore = {
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    refs: new MemoryRefStore(),
    staging: new MemoryStagingStore(),
    tags: stores.tags,
  };
  return { store };
};

/**
 * SQL backend factory (persistent, uses sql.js in-memory)
 */
export const sqlFactory: GitStoreFactory = async () => {
  const db = await SqlJsAdapter.create();
  await initializeSchema(db);
  const stores = createSqlObjectStores({ db });
  const store: GitStore = {
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    refs: new SQLRefStore(db),
    staging: new SQLStagingStore(db),
    tags: stores.tags,
  };
  return {
    store,
    cleanup: async () => {
      await db.close();
    },
  };
};

/**
 * All available backends for cross-backend testing
 */
export const backends: Array<{ name: string; factory: GitStoreFactory }> = [
  { name: "Memory", factory: memoryFactory },
  { name: "SQL", factory: sqlFactory },
];

/**
 * Default backend for single-backend tests
 */
export const defaultFactory = memoryFactory;
