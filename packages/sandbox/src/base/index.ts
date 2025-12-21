/**
 * Base storage implementations
 *
 * Provides repository interfaces and default implementations for
 * content-addressable object storage with delta compression.
 */

// Default implementation
export * from "./default-object-store.js";

// Re-export cache utilities from @webrun-vcs/utils
export { IntermediateCache, LRUCache } from "@webrun-vcs/utils";

// Repository type definitions
export * from "./repositories/index.js";
// Type definitions
export * from "./types.js";
