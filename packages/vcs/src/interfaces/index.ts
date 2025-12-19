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

// Core types and store interfaces from object-storage
export * from "../object-storage/interfaces/index.js";

// Git object storage interface
export * from "./git-object-store.js";
export * from "./object-store.js";
// Staging interfaces
export * from "./staging-edits.js";
export * from "./staging-store.js";

// Low-level storage interfaces
export * from "./temp-store.js";

// Utilities
export * from "./utils/index.js";
