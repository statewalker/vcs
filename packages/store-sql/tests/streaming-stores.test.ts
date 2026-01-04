/**
 * Integration tests for streaming stores
 */

import { createStreamingStoresTests } from "@statewalker/vcs-testing";
import { SqlJsAdapter } from "../src/adapters/sql-js-adapter.js";
import { createStreamingSqlStores } from "../src/create-streaming-stores.js";

// Run the standard streaming stores test suite
createStreamingStoresTests("SQL", async () => {
  const db = await SqlJsAdapter.create();
  const stores = createStreamingSqlStores(db);
  return {
    stores,
    cleanup: async () => {
      await db.close();
    },
  };
});
