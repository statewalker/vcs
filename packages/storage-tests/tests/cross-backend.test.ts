/**
 * Cross-backend integration tests
 *
 * Verifies that all storage backends produce identical Git object IDs
 * and can interoperate by transferring objects between backends.
 */

import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import { createStreamingFileStores } from "@webrun-vcs/store-files";
import { createStreamingKvStores, MemoryKVAdapter } from "@webrun-vcs/store-kv";
import { createStreamingMemoryStores } from "@webrun-vcs/store-mem";
import { createStreamingSqlStores } from "@webrun-vcs/store-sql";
import { SqlJsAdapter } from "@webrun-vcs/store-sql/adapters/sql-js";
import {
  createCrossBackendTests,
  createStreamingStoresTests,
  type StreamingStoresFactory,
} from "@webrun-vcs/testing";
import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { beforeAll } from "vitest";

beforeAll(() => {
  setCompression(createNodeCompression());
});

// Factory for memory backend
const memoryFactory: StreamingStoresFactory = async () => {
  const stores = createStreamingMemoryStores();
  return { stores };
};

// Factory for KV backend
const kvFactory: StreamingStoresFactory = async () => {
  const kv = new MemoryKVAdapter();
  const stores = createStreamingKvStores(kv);
  return { stores };
};

// Factory for SQL backend
const sqlFactory: StreamingStoresFactory = async () => {
  const db = await SqlJsAdapter.create();
  const stores = createStreamingSqlStores(db);
  return {
    stores,
    cleanup: async () => {
      await db.close();
    },
  };
};

// Factory for file backend (uses in-memory FilesApi)
const fileFactory: StreamingStoresFactory = async () => {
  const files = new FilesApi(new MemFilesApi());
  const objectsDir = "/test-repo/objects";
  const stores = createStreamingFileStores(files, objectsDir);
  return { stores };
};

// Define all backends for cross-backend testing
const backends = [
  { name: "Memory", factory: memoryFactory },
  { name: "KV", factory: kvFactory },
  { name: "SQL", factory: sqlFactory },
  { name: "File", factory: fileFactory },
];

// Run individual backend tests to verify each one works
createStreamingStoresTests("Memory", memoryFactory);
createStreamingStoresTests("KV", kvFactory);
createStreamingStoresTests("SQL", sqlFactory);
createStreamingStoresTests("File", fileFactory);

// Run cross-backend roundtrip tests
createCrossBackendTests(backends);
