/**
 * Backend factory functions for integration tests
 *
 * Provides factory functions to create GitStore instances with 3 backends:
 * 1. Memory - Fastest, pure in-memory storage
 * 2. SQL - sql.js in-memory database
 * 3. FilesAPI - Git-compatible file-based storage (in-memory FilesAPI)
 */

import { createGitStore, type GitStore } from "@statewalker/vcs-commands";
import { createGitRepository, createInMemoryFilesApi } from "@statewalker/vcs-core";
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

// Enable Node.js compression for SQL backend
setCompressionUtils(createNodeCompression());

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
 * Memory backend factory (fastest, no cleanup needed)
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
 * SQL backend factory (uses sql.js in-memory)
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
 * FilesAPI backend factory (Git-compatible file storage, in-memory)
 */
export const filesApiFactory: GitStoreFactory = async () => {
  const files = createInMemoryFilesApi();
  const repository = await createGitRepository(files, ".git", {
    create: true,
    defaultBranch: "main",
  });
  const staging = new MemoryStagingStore();
  const store = createGitStore({ repository, staging });
  return { store };
};

/**
 * All available backends for cross-backend testing
 */
export const backends: Array<{ name: string; factory: GitStoreFactory }> = [
  { name: "Memory", factory: memoryFactory },
  { name: "SQL", factory: sqlFactory },
  { name: "FilesAPI", factory: filesApiFactory },
];

/**
 * Default backend for single-backend tests
 */
export const defaultFactory = memoryFactory;
