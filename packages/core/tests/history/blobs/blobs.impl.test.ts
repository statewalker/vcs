/**
 * Tests for BlobsImpl using MemoryRawStorage
 *
 * Runs conformance tests against the new Blobs implementation.
 */

import { MemoryRawStorage } from "../../../src/storage/raw/memory-raw-storage.js";
import { createBlobs } from "../../../src/history/blobs/blobs.impl.js";
import type { Blobs } from "../../../src/history/blobs/blobs.js";
import { blobsConformanceTests } from "./blobs.conformance.test.js";

let storage: MemoryRawStorage;

blobsConformanceTests(
  "BlobsImpl",
  async (): Promise<Blobs> => {
    storage = new MemoryRawStorage();
    return createBlobs(storage);
  },
  async (): Promise<void> => {
    storage.clear();
  },
);
