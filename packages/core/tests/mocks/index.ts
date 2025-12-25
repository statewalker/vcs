/**
 * Shared mock implementations for testing
 */

// Re-export the actual MemoryRawStore as it works well for tests
export { MemoryRawStore } from "../../src/binary/impl/memory-raw-store.js";
export * from "./mock-commit-store.js";
export * from "./mock-delta-store.js";
