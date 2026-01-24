// Git-native repository access (direct passthrough to GitObjectStore)
export * from "./git-native-repository-access.js";
// Object graph walker
export * from "./object-graph-walker.js";
// Storage adapter (legacy)
export * from "./storage-adapter.js";
// VCS repository access (uses high-level stores)
export {
  createVcsRepositoryAccess,
  VcsRepositoryAccess,
  type VcsRepositoryAccessParams,
} from "./vcs-repository-access.js";
// VCS repository facade (RepositoryFacade using high-level stores)
export {
  createVcsRepositoryFacade,
  VcsRepositoryFacade,
  type VcsRepositoryFacadeParams,
} from "./vcs-repository-facade.js";
// Wire format utilities
export * from "./wire-format-utils.js";
