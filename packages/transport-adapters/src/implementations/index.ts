export * from "./git-native-repository-access.js";
export * from "./git-serializers.js";
export * from "./serializing-repository-access.js";
export * from "./types.js";

// VcsRepositoryAccess - uses high-level stores without GitObjectStore
export {
  createVcsRepositoryAccess,
  VcsRepositoryAccess,
  type VcsRepositoryAccessParams,
} from "./vcs-repository-access.js";
export * from "./wire-format-utils.js";
