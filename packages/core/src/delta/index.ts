// Re-export DeltaReverseIndex from pack/ for backwards compatibility
export { type DeltaRelationship, DeltaReverseIndex } from "../pack/delta-reverse-index.js";
// Re-export PackDeltaStore from pack/ for backwards compatibility
// Consumers should eventually import from pack/ directly
export { PackDeltaStore, type PackDeltaStoreOptions } from "../pack/pack-delta-store.js";
export * from "./delta-binary-format.js";
export * from "./delta-store.js";
export * from "./gc-controller.js";
export * from "./packing-orchestrator.js";
export * from "./raw-store-with-delta.js";
export * from "./storage-analyzer.js";
export * from "./strategies/index.js";
export * from "./types.js";
