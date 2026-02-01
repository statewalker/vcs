// Shared types (canonical source) - includes deprecated StagingStore for backward compatibility

// Utilities
export * from "./conflict-utils.js";
// New Staging implementations (Phase C4)
export * from "./git-staging.js";
export * from "./simple-staging.js";
// New Staging interface (Phase C4)
export * from "./staging.js";
export * from "./staging-edits.js";
// Legacy implementation (for backward compatibility)
export * from "./staging-store.files.js";
export * from "./types.js";
