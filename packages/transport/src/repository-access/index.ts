// Implementations
export * from "./git-native-repository-access.js";
// Serialization utilities (re-exports from core)
export * from "./git-serializers.js";
export * from "./serializing-repository-access.js";

// Types are re-exported from core, not from here, to avoid conflicts
// with handlers/types.ts which has its own RepositoryAccess interface
// Import types directly from @statewalker/vcs-core
