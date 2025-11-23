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

// Re-export everything from the text-diff module
export {
	// Core abstractions
	Sequence,
	type SequenceComparator,
	// Edit data structures
	Edit,
	EditType,
	type EditList,
	// Text sequence implementation
	RawText,
	RawTextComparator,
	// Hashed sequences for performance
	HashedSequence,
	HashedSequenceComparator,
	HashedSequencePair,
	// Diff algorithm
	MyersDiff,
} from "./text-diff/index.js";

// Re-export everything from the patch module
export {
	// Patch parsing
	Patch,
	FileHeader,
	HunkHeader,
	BinaryHunk,
	// Encoding/decoding
	encodeGitBase85,
	decodeGitBase85,
	// Cryptographic operations
	type CryptoProvider,
	WebCryptoProvider,
	NodeCryptoProvider,
	sha1,
	sha256,
	gitObjectHash,
	// Buffer utilities
	match,
	nextLF,
	prevLF,
	isHunkHdr,
	decode,
	encodeASCII,
	parseBase10,
	// Types
	type PatchOptions,
	type FormatError,
	type FileMode,
	type ObjectId,
	type ApplyResult,
	type ApplyError,
	PatchType,
	ChangeType,
	BinaryHunkType,
	createFileMode,
} from "./patch/index.js";
