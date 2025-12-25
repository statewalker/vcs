/**
 * Delta binary format conversion
 *
 * Re-exports Git delta format functions from @webrun-vcs/utils
 * for convenient access from the core package's delta module.
 *
 * These functions convert between format-agnostic Delta[] instructions
 * and Git's binary delta format used in pack files.
 */

import {
  deserializeDeltaFromGit as _deserializeDeltaFromGit,
  serializeDeltaToGit as _serializeDeltaToGit,
  deltaRangesToGitFormat,
  deltaToGitFormat,
  formatGitDelta,
  type GitDeltaInstruction,
  getGitDeltaBaseSize,
  getGitDeltaResultSize,
  gitFormatToDeltaRanges,
  parseGitDelta,
} from "@webrun-vcs/utils";

// Re-export with original names
export {
  deltaToGitFormat,
  deltaRangesToGitFormat,
  parseGitDelta,
  formatGitDelta,
  gitFormatToDeltaRanges,
  getGitDeltaBaseSize,
  getGitDeltaResultSize,
  type GitDeltaInstruction,
};

// Export with original names
export { _serializeDeltaToGit as serializeDeltaToGit };
export { _deserializeDeltaFromGit as deserializeDeltaFromGit };

// Convenience aliases for the common operations
export { _serializeDeltaToGit as serializeDelta };
export { _deserializeDeltaFromGit as parseBinaryDelta };
