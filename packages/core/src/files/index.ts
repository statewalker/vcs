/**
 * Files API re-exports
 *
 * Re-exports from @statewalker/vcs-utils/files for backwards compatibility.
 * All new code should import directly from @statewalker/vcs-utils/files.
 */

// Re-export everything from vcs-utils/files
// Note: isNotFoundError and tryReadFile are not re-exported here
// because they conflict with ./utils/file-utils.ts exports.
// In Phase 3b, the utils/file-utils.ts will be updated to use
// the utility functions from vcs-utils/files.
export {
  basename,
  createInMemoryFilesApi,
  createNodeFilesApi,
  dirname,
  extname,
  type FileInfo,
  FileMode,
  type FileModeValue,
  type FileStats,
  type FilesApi,
  joinPath,
  normalizePath,
  type ReadOptions,
  readAt,
  readFile,
  readRange,
  readText,
  tryReadText,
} from "@statewalker/vcs-utils/files";
