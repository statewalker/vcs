// Shared types (canonical source)

// Utilities
export * from "./conflict-utils.js";
// New Staging implementations (Phase C4)
export * from "./git-staging.js";
export * from "./simple-staging.js";
// New Staging interface (Phase C4)
export * from "./staging.js";
export * from "./staging-edits.js";
export * from "./staging-store.files.js";

// Legacy interface (deprecated, for backward compatibility)
export * from "./staging-store.js";
export * from "./types.js";
