/**
 * ObjectStorage tests for InMemory implementation
 */

import {
  createObjectStorageTests,
  createDeltaObjectStorageTests,
} from "@webrun-vcs/storage-tests";
import { createMemoryStorage } from "../src/index.js";

// Run the standard ObjectStorage test suite
createObjectStorageTests("InMemory", async () => ({
  storage: createMemoryStorage(),
}));

// Run the DeltaObjectStorage test suite
createDeltaObjectStorageTests("InMemory", async () => ({
  storage: createMemoryStorage(),
}));
