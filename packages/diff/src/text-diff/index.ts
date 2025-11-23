// Core abstractions

// Edit data structures
export { Edit, type EditList, EditType } from "./edit.js";
// Hashed sequences for performance
export {
  HashedSequence,
  HashedSequenceComparator,
  HashedSequencePair,
} from "./hashed-sequence.js";
// Diff algorithm
export { MyersDiff } from "./myers-diff.js";
// Text sequence implementation
export { RawText } from "./raw-text.js";
export { RawTextComparator } from "./raw-text-comparator.js";
export { Sequence, type SequenceComparator } from "./sequence.js";
