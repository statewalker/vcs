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
export { HistoryImpl, HistoryWithBackendImpl } from "./history.impl.js";
// New History facade (Phase C3)
export type { History, HistoryWithBackend } from "./history.js";

// Legacy HistoryStore (to be removed in C3.7)
export * from "./history-store.js";

// Base interface for content-addressed stores (Phase C)
export * from "./object-storage.js";
export * from "./objects/index.js";
export * from "./refs/index.js";
export * from "./structured-stores.js";
export * from "./tags/index.js";
export * from "./trees/index.js";
