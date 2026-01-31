export * from "./blobs/index.js";
export * from "./commits/index.js";
export type {
  HistoryBackendConfig,
  HistoryComponentsConfig,
  HistoryStoresConfig,
} from "./create-history.js";
export {
  createHistoryFromBackend,
  createHistoryFromComponents,
  createHistoryFromStores,
  createMemoryHistory,
} from "./create-history.js";
// Format utilities for Git object serialization (moved from common/format)
export * from "./format/index.js";
// Object hash functions for deterministic ID computation (moved from common/hash)
export * from "./hash/index.js";
export { HistoryImpl, HistoryWithBackendImpl } from "./history.impl.js";
// New History facade (Phase C3)
export type { History, HistoryWithBackend } from "./history.js";

// Legacy HistoryStore (deprecated - use History instead)
export * from "./history-store.js";

// Base interface for content-addressed stores (Phase C)
export * from "./object-storage.js";
export * from "./objects/index.js";
export * from "./refs/index.js";
// Legacy StructuredStores (deprecated - use History instead)
export * from "./structured-stores.js";
export * from "./tags/index.js";
export * from "./trees/index.js";
