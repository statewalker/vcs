// Re-export everything from the delta module
export {
  // Delta range generation algorithms
  createDeltaRanges,
  createFossilLikeRanges,
  buildSourceIndex,
  rollingInit,
  rollingSlide,
  rollingValue,
  weakChecksum,
  strongChecksum,
  emitRange,
  DEFAULT_BLOCK_SIZE,
  // Delta creation and application
  createDelta,
  applyDelta,
  // Encoding/decoding
  decodeDeltaBlocks,
  encodeDeltaBlocks,
  // Utilities
  Checksum,
  mergeChunks,
  // Types
  type Delta,
  type DeltaRange,
  type RollingChecksum,
  type SourceBlock,
  type SourceIndex,
} from "./delta/index.js";
