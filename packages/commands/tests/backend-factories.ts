/**
 * Backend factory functions for multi-backend testing
 *
 * Provides factory functions to create WorkingCopy instances with different backends.
 * Used for testing commands across Memory, SQL, and other storage implementations.
 *
 * @see WorkingCopy for the primary architecture
 */

import type { History, WorkingCopy } from "@statewalker/vcs-core";
import { MemoryCheckout, MemoryWorkingCopy } from "@statewalker/vcs-core";
import {
  createMemoryObjectStores,
  MemoryRefStore,
  MemoryStagingStore,
} from "@statewalker/vcs-store-mem";
import {
  createSqlObjectStores,
  initializeSchema,
  SQLRefStore,
  SQLStaging,
} from "@statewalker/vcs-store-sql";
import { SqlJsAdapter } from "@statewalker/vcs-store-sql/adapters/sql-js";
import { setCompressionUtils } from "@statewalker/vcs-utils";
import { createNodeCompression } from "@statewalker/vcs-utils-node/compression";

import { createMockWorktree } from "./mock-worktree-store.js";
import { createSimpleHistory } from "./simple-history-store.js";

// Enable Node.js compression for SQL backend
setCompressionUtils(createNodeCompression());

/**
 * Test context for WorkingCopy tests
 *
 * Provides access to WorkingCopy and its underlying repository for testing.
 */
export interface WorkingCopyTestContext {
  /** The WorkingCopy instance (primary interface) */
  workingCopy: WorkingCopy;
  /** Direct access to the repository (History) for test setup/verification */
  repository: History;
  /** Cleanup function to call after test */
  cleanup?: () => Promise<void>;
}

/**
 * Factory function to create WorkingCopy instances for testing
 */
export type WorkingCopyFactory = () => Promise<WorkingCopyTestContext>;

/**
 * Memory backend factory (default, fastest)
 *
 * Creates a WorkingCopy with in-memory storage.
 */
export const memoryFactory: WorkingCopyFactory = async () => {
  const stores = createMemoryObjectStores();
  const refs = new MemoryRefStore();
  const staging = new MemoryStagingStore();

  // Create History wrapper using new store interfaces
  const repository = createSimpleHistory({
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    tags: stores.tags,
    refs,
  });

  // Create mock Worktree
  const worktree = createMockWorktree();

  // Create Checkout with staging
  const checkout = new MemoryCheckout({ staging });

  // Create WorkingCopy
  const workingCopy = new MemoryWorkingCopy({
    history: repository,
    checkout,
    worktree,
  });

  return { workingCopy, repository };
};

/**
 * SQL backend factory (persistent, uses sql.js in-memory)
 *
 * Creates a WorkingCopy with SQL-backed storage.
 */
export const sqlFactory: WorkingCopyFactory = async () => {
  const db = await SqlJsAdapter.create();
  await initializeSchema(db);
  const stores = createSqlObjectStores({ db });
  const refs = new SQLRefStore(db);
  const staging = new SQLStaging(db);

  // Create History wrapper using new store interfaces
  const repository = createSimpleHistory({
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    tags: stores.tags,
    refs,
  });

  // Create mock Worktree
  const worktree = createMockWorktree();

  // Create Checkout with staging
  const checkout = new MemoryCheckout({ staging });

  // Create WorkingCopy
  const workingCopy = new MemoryWorkingCopy({
    history: repository,
    checkout,
    worktree,
  });

  return {
    workingCopy,
    repository,
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
