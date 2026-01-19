export * from "./git-native-repository-access.js";
export * from "./object-graph-walker.js";

// VcsRepositoryAccess - uses high-level stores without GitObjectStore
export {
  createVcsRepositoryAccess,
  VcsRepositoryAccess,
  type VcsRepositoryAccessParams,
} from "./vcs-repository-access.js";
export * from "./wire-format-utils.js";
