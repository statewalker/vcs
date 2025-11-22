// Export all delta range generation algorithms
export { createDeltaRanges } from "./create-delta-ranges.js";
export {
  createFossilLikeRanges,
  buildSourceIndex,
  rollingInit,
  rollingSlide,
  rollingValue,
  weakChecksum,
  strongChecksum,
  emitRange,
  DEFAULT_BLOCK_SIZE,
  type RollingChecksum,
  type SourceBlock,
  type SourceIndex,
} from "./create-fossil-ranges.js";

// Export delta creation and application
export { createDelta } from "./create-delta.js";
export { applyDelta } from "./apply-delta.js";

// Export encoding/decoding
export {
  decodeDeltaBlocks,
  encodeDeltaBlocks,
} from "./fossil-delta-format.js";

// Export utilities
export { Checksum } from "./checksum-obj.js";
export { mergeChunks } from "./merge-chunks.js";

// Export types
export type { Delta, DeltaRange } from "./types.js";
