// Patch parsing
export { Patch } from "./patch.js";

// Encoding/decoding
export { encodeGitBase85, decodeGitBase85 } from "./base85.js";

// Cryptographic operations
export {
	type CryptoProvider,
	WebCryptoProvider,
	NodeCryptoProvider,
	sha1,
	sha256,
	gitObjectHash,
} from "./crypto.js";

// Buffer utilities
export {
	match,
	nextLF,
	prevLF,
	isHunkHdr,
	decode,
	encodeASCII,
	parseBase10,
} from "./buffer-utils.js";

// Types
export {
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
} from "./types.js";
