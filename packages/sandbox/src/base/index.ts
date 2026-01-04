/**
 * Base storage implementations
 *
 * Provides repository interfaces and default implementations for
 * content-addressable object storage with delta compression.
 */

// Re-export cache utilities from @statewalker/vcs-utils
export { IntermediateCache, LRUCache } from "@statewalker/vcs-utils";
// Default implementation
export * from "./default-object-store.js";

// Repository type definitions
export * from "./repositories/index.js";
// Type definitions
export * from "./types.js";
