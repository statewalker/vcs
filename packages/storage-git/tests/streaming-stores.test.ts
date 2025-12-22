/**
 * Integration tests for streaming stores using file-based backend
 */

import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import { createStreamingStoresTests } from "@webrun-vcs/testing";
import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { beforeAll } from "vitest";
import { createStreamingFileStores } from "../src/create-streaming-stores.js";

beforeAll(() => {
  setCompression(createNodeCompression());
});

// Run the standard streaming stores test suite
createStreamingStoresTests("File", async () => {
  const files = new FilesApi(new MemFilesApi());
  const objectsDir = "/test-repo/objects";

  const stores = createStreamingFileStores(files, objectsDir);

  return {
    stores,
    // No cleanup needed for memory-backed FilesApi
  };
});
