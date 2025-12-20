/**
 * VCS Interfaces
 *
 * Core interfaces for version control system storage.
 *
 * **New Architecture (recommended):**
 * - `@webrun-vcs/vcs/binary-storage` - RawStore, DeltaStore, BinStore
 * - `@webrun-vcs/vcs/object-storage` - GitObjectStore, typed stores
 * - `@webrun-vcs/vcs/delta-compression` - DeltaStorageImpl
 * - `@webrun-vcs/vcs/garbage-collection` - GCController
 */

// Re-export all types from object-storage interfaces for convenience
export * from "./object-store.js";
export * from "./staging-edits.js";
export * from "./staging-store.js";
// Low-level storage interfaces
export * from "./temp-store.js";
// Utilities
export * from "./utils/index.js";
