/**
 * Repository tests for SQL implementations
 */

import {
  createDeltaRepositoryTests,
  createMetadataRepositoryTests,
  createObjectRepositoryTests,
} from "@webrun-vcs/storage-tests";
import { SqlJsAdapter } from "../src/adapters/sql-js-adapter.js";
import { SQLDeltaRepository } from "../src/delta-repository.js";
import { SQLMetadataRepository } from "../src/metadata-repository.js";
import { initializeSchema } from "../src/migrations/index.js";
import { SQLObjectRepository } from "../src/object-repository.js";

// SQLObjectRepository is used in multiple test factories below

/**
 * Create a fresh database with schema for testing
 */
async function createTestDb() {
  const db = await SqlJsAdapter.create();
  await initializeSchema(db);
  return db;
}

// Run the standard ObjectRepository test suite
createObjectRepositoryTests("SQL", async () => {
  const db = await createTestDb();
  return {
    repo: new SQLObjectRepository(db),
    cleanup: async () => {
      await db.close();
    },
  };
});

// Run the standard DeltaRepository test suite
createDeltaRepositoryTests("SQL", async () => {
  const db = await createTestDb();
  return {
    repo: new SQLDeltaRepository(db),
    cleanup: async () => {
      await db.close();
    },
  };
});

// Run the standard MetadataRepository test suite
createMetadataRepositoryTests("SQL", async () => {
  const db = await createTestDb();
  return {
    repo: new SQLMetadataRepository(db),
    cleanup: async () => {
      await db.close();
    },
  };
});
