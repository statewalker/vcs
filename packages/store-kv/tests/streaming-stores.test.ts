/**
 * Integration tests for streaming stores
 */

import { createStreamingStoresTests } from "@webrun-vcs/testing";
import { MemoryKVAdapter } from "../src/adapters/memory-adapter.js";
import { createStreamingKvStores } from "../src/create-streaming-stores.js";

// Run the standard streaming stores test suite
createStreamingStoresTests("KV", async () => {
  const kv = new MemoryKVAdapter();
  const stores = createStreamingKvStores(kv);
  return {
    stores,
    // No cleanup needed for memory KV
  };
});
