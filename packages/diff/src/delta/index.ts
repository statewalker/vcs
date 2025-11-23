// Export all delta range generation algorithms

export { applyDelta } from "./apply-delta.js";
// Export utilities
export { Checksum } from "./checksum-obj.js";

// Export delta creation and application
export { createDelta } from "./create-delta.js";
export { createDeltaRanges } from "./create-delta-ranges.js";
export {
  buildSourceIndex,
  createFossilLikeRanges,
  DEFAULT_BLOCK_SIZE,
  emitRange,
  type RollingChecksum,
  rollingInit,
  rollingSlide,
  rollingValue,
  type SourceBlock,
  type SourceIndex,
  strongChecksum,
  weakChecksum,
} from "./create-fossil-ranges.js";
// Export encoding/decoding
export {
  decodeDeltaBlocks,
  encodeDeltaBlocks,
} from "./fossil-delta-format.js";
export { mergeChunks } from "./merge-chunks.js";

// Export types
export type { Delta, DeltaRange } from "./types.js";
