/**
 * Repository tests for InMemory implementations
 */

import {
  createObjectRepositoryTests,
  createDeltaRepositoryTests,
  createMetadataRepositoryTests,
} from "@webrun-vcs/storage-tests";
import {
  InMemoryObjectRepository,
  InMemoryDeltaRepository,
  InMemoryMetadataRepository,
} from "../src/index.js";

// Run the standard ObjectRepository test suite
createObjectRepositoryTests("InMemory", async () => ({
  repo: new InMemoryObjectRepository(),
}));

// Run the standard DeltaRepository test suite
createDeltaRepositoryTests("InMemory", async () => ({
  repo: new InMemoryDeltaRepository(),
}));

// Run the standard MetadataRepository test suite
createMetadataRepositoryTests("InMemory", async () => ({
  repo: new InMemoryMetadataRepository(),
}));
