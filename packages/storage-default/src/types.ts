/**
 * Storage layer types for object and delta management
 *
 * Re-exports repository types from @webrun-vcs/storage for backward compatibility.
 */

// Re-export repository types from storage package
export type {
  ObjectEntry,
  DeltaEntry,
  CacheMetadata,
  RepositoryStats,
} from "@webrun-vcs/storage";
