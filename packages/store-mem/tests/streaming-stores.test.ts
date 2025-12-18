/**
 * Integration tests for streaming stores
 */

import { createStreamingStoresTests } from "@webrun-vcs/testing";
import { createStreamingMemoryStores } from "../src/create-streaming-stores.js";

// Run the standard streaming stores test suite
createStreamingStoresTests("Memory", async () => {
  const stores = createStreamingMemoryStores();
  return {
    stores,
    // No cleanup needed for memory stores
  };
});
