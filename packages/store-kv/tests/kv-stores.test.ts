/**
 * Tests for KV-based store implementations
 *
 * Uses the parametrized test suites from @webrun-vcs/testing
 * to verify the KV implementations follow the interface contracts.
 */

import {
  createCommitStoreTests,
  createRefStoreTests,
  createStagingStoreTests,
  createTagStoreTests,
  createTreeStoreTests,
} from "@webrun-vcs/testing";
import { MemoryKVAdapter } from "../src/adapters/memory-adapter.js";
import { KVCommitStore } from "../src/kv-commit-store.js";
import { KVRefStore } from "../src/kv-ref-store.js";
import { KVStagingStore } from "../src/kv-staging-store.js";
import { KVTagStore } from "../src/kv-tag-store.js";
import { KVTreeStore } from "../src/kv-tree-store.js";

// TreeStore tests
createTreeStoreTests("KV", async () => {
  const kv = new MemoryKVAdapter();
  return {
    treeStore: new KVTreeStore(kv),
    cleanup: async () => {
      await kv.close();
    },
  };
});

// CommitStore tests
createCommitStoreTests("KV", async () => {
  const kv = new MemoryKVAdapter();
  return {
    commitStore: new KVCommitStore(kv),
    cleanup: async () => {
      await kv.close();
    },
  };
});

// TagStore tests
createTagStoreTests("KV", async () => {
  const kv = new MemoryKVAdapter();
  return {
    tagStore: new KVTagStore(kv),
    cleanup: async () => {
      await kv.close();
    },
  };
});

// RefStore tests
createRefStoreTests("KV", async () => {
  const kv = new MemoryKVAdapter();
  return {
    refStore: new KVRefStore(kv),
    cleanup: async () => {
      await kv.close();
    },
  };
});

// StagingStore tests
createStagingStoreTests("KV", async () => {
  const kv = new MemoryKVAdapter();
  return {
    stagingStore: new KVStagingStore(kv),
    treeStore: new KVTreeStore(kv),
    cleanup: async () => {
      await kv.close();
    },
  };
});
