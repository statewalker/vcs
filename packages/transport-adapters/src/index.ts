// Git-native repository access (direct passthrough to GitObjectStore)
export * from "./git-native-repository-access.js";
// Object graph walker
export * from "./object-graph-walker.js";
// Storage adapter (legacy)
export * from "./storage-adapter.js";
// VCS repository access (uses History facade)
export {
  createVcsRepositoryAccess,
  VcsRepositoryAccess,
  type VcsRepositoryAccessConfig,
} from "./vcs-repository-access.js";
// VCS repository facade (RepositoryFacade using History facade)
export {
  createVcsRepositoryFacade,
  VcsRepositoryFacade,
  type VcsRepositoryFacadeConfig,
} from "./vcs-repository-facade.js";
// Wire format utilities
export * from "./wire-format-utils.js";
