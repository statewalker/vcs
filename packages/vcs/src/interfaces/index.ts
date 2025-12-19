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

// Typed store interfaces (actively used)
export * from "./blob-store.js";
export * from "./commit-store.js";
// Git object storage interface
export * from "./git-object-store.js";
// Combined stores interface
export * from "./git-stores.js";
export * from "./object-store.js";
export * from "./ref-store.js";
// Staging interfaces
export * from "./staging-edits.js";
export * from "./staging-store.js";
export * from "./tag-store.js";

// Low-level storage interfaces
export * from "./temp-store.js";
export * from "./tree-store.js";
// Core type definitions
export * from "./types.js";

// Utilities
export * from "./utils/index.js";

// =============================================================================
// DEPRECATED INTERFACES
// These are maintained for backwards compatibility.
// Use the new architecture modules instead.
// =============================================================================

/**
 * @deprecated Use DeltaStore from '@webrun-vcs/vcs/binary-storage' instead
 */
export * from "./delta-chain-store.js";
/**
 * @deprecated Use DeltaStorageImpl from '@webrun-vcs/vcs/delta-compression' instead
 */
export * from "./delta-object-store.js";
/**
 * @deprecated Use DeltaStorageImpl from '@webrun-vcs/vcs/delta-compression' instead
 */
export * from "./delta-storage-manager.js";
/**
 * @deprecated Use types from '@webrun-vcs/vcs/delta-compression' instead
 */
export * from "./delta-strategies.js";
/**
 * @deprecated Use RawStore from '@webrun-vcs/vcs/binary-storage' instead
 */
export * from "./raw-storage.js";
