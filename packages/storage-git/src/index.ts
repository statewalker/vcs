/**
 * @webrun-vcs/storage-git
 *
 * Git-compatible storage implementation.
 * Provides ObjectStorage, FileTreeStorage, CommitStorage, and TagStorage
 * implementations that read and write standard Git repository format.
 */

// File system abstraction (for custom backends)
export * from "./file-api/index.js";

// Format utilities (for advanced use cases)
export * from "./format/index.js";

// Utility functions
export * from "./utils/index.js";

// Loose object handling
export * from "./loose/index.js";

// Pack file handling
export * from "./pack/index.js";

// Refs handling
export * from "./refs/index.js";

// Main storage implementations (placeholder)
// export * from "./git-storage.js";
// export * from "./git-object-storage.js";
// export * from "./git-file-tree-storage.js";
// export * from "./git-commit-storage.js";
// export * from "./git-tag-storage.js";
