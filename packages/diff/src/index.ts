// Re-export everything from the delta module
export {
  applyDelta,
  buildSourceIndex,
  // Utilities
  Checksum,
  // Delta creation and application
  createDelta,
  // Delta range generation algorithms
  createDeltaRanges,
  createFossilLikeRanges,
  DEFAULT_BLOCK_SIZE,
  // Types
  type Delta,
  type DeltaRange,
  // Encoding/decoding
  decodeDeltaBlocks,
  emitRange,
  encodeDeltaBlocks,
  mergeChunks,
  type RollingChecksum,
  rollingInit,
  rollingSlide,
  rollingValue,
  type SourceBlock,
  type SourceIndex,
  strongChecksum,
  weakChecksum,
} from "./delta/index.js";
// Re-export everything from the patch module
export {
  type ApplyError,
  type ApplyOptions,
  type ApplyResult,
  BinaryHunk,
  BinaryHunkType,
  ChangeType,
  // Cryptographic operations
  type CryptoProvider,
  createFileMode,
  decode,
  decodeGitBase85,
  encodeASCII,
  // Encoding/decoding
  encodeGitBase85,
  type FileApplyResult,
  FileHeader,
  type FileMode,
  type FormatError,
  gitObjectHash,
  HunkHeader,
  isHunkHdr,
  // Buffer utilities
  match,
  NodeCryptoProvider,
  nextLF,
  type ObjectId,
  // Patch parsing
  Patch,
  // Patch application
  PatchApplier,
  // Types
  type PatchOptions,
  PatchType,
  parseBase10,
  prevLF,
  sha1,
  sha256,
  WebCryptoProvider,
} from "./patch/index.js";
// Re-export everything from the text-diff module
export {
  // Edit data structures
  Edit,
  type EditList,
  EditType,
  // Hashed sequences for performance
  HashedSequence,
  HashedSequenceComparator,
  HashedSequencePair,
  // Diff algorithm
  MyersDiff,
  // Text sequence implementation
  RawText,
  RawTextComparator,
  // Core abstractions
  Sequence,
  type SequenceComparator,
} from "./text-diff/index.js";
