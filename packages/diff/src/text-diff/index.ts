// Core abstractions
export { Sequence, type SequenceComparator } from "./sequence.js";

// Edit data structures
export { Edit, EditType, type EditList } from "./edit.js";

// Text sequence implementation
export { RawText } from "./raw-text.js";
export { RawTextComparator } from "./raw-text-comparator.js";

// Hashed sequences for performance
export {
	HashedSequence,
	HashedSequenceComparator,
	HashedSequencePair,
} from "./hashed-sequence.js";

// Diff algorithm
export { MyersDiff } from "./myers-diff.js";
