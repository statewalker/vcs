/**
 * WebRun VCS Core Package
 *
 * Provides interfaces and implementations for content-addressable
 * object storage with delta compression.
 */

// Base implementations
export * from "./base/index.js";

// Format utilities
export * from "./format/index.js";

// Interfaces
export * from "./interfaces/index.js";

// New architecture modules available via separate entry points:
// - '@webrun-vcs/vcs/binary-storage' - Low-level byte storage (RawStore, DeltaStore, BinStore)
// - '@webrun-vcs/vcs/object-storage' - Git-compatible object storage (GitObjectStore, typed stores)
// - '@webrun-vcs/vcs/delta-compression' - Delta storage implementation (DeltaStorageImpl)
// - '@webrun-vcs/vcs/garbage-collection' - GC and packing (GCController)
