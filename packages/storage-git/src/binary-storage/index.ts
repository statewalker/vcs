/**
 * Binary storage implementations for file-based backend
 *
 * Provides RawStore, DeltaStore, BinStore, and VolatileStore
 * implementations using the filesystem.
 *
 * FileRawStore and FileVolatileStore are re-exported from @webrun-vcs/core.
 */

// Re-export from core for backwards compatibility
export { FileRawStore, FileVolatileStore } from "@webrun-vcs/core";
export * from "./file-bin-store.js";
export * from "./file-delta-store.js";
