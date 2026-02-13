// Backend layer (unified storage contract)
export * from "./backend/index.js";
// Common types: files, format, id, person
export * from "./common/index.js";
// History layer (objects, commits, trees, blobs, tags, refs)
export * from "./history/index.js";
// Storage layer (binary, delta)
export * from "./storage/index.js";
// Workspace layer (worktree, staging, status, checkout, working-copy)
export * from "./workspace/index.js";
