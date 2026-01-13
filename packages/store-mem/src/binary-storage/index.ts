// Re-export MemoryRawStore from core with alias for backward compatibility
export { MemoryRawStore, MemoryRawStore as MemRawStore } from "@statewalker/vcs-core";

export * from "./mem-bin-store.js";
export * from "./mem-delta-store.js";
