// Shared types (canonical source) - includes deprecated WorktreeStore for backward compatibility

// New Worktree implementations (Phase C4)
export * from "./file-worktree.js";
export * from "./memory-worktree.js";
export * from "./types.js";
// New Worktree interface (Phase C4)
export * from "./worktree.js";

// Legacy implementation (for backward compatibility)
export * from "./worktree-store.impl.js";
