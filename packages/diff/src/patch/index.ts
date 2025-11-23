// Patch parsing

// Encoding/decoding
export { decodeGitBase85, encodeGitBase85 } from "./base85.js";
export { BinaryHunk } from "./binary-hunk.js";
// Buffer utilities
export {
  decode,
  encodeASCII,
  isHunkHdr,
  match,
  nextLF,
  parseBase10,
  prevLF,
} from "./buffer-utils.js";
// Cryptographic operations
export {
  type CryptoProvider,
  gitObjectHash,
  NodeCryptoProvider,
  sha1,
  sha256,
  WebCryptoProvider,
} from "./crypto.js";
export { FileHeader } from "./file-header.js";
export { HunkHeader } from "./hunk-header.js";
export { Patch } from "./patch.js";
// Patch application
export {
  type ApplyOptions,
  type FileApplyResult,
  PatchApplier,
} from "./patch-applier.js";

// Types
export {
  type ApplyError,
  type ApplyResult,
  BinaryHunkType,
  ChangeType,
  createFileMode,
  type FileMode,
  type FormatError,
  type ObjectId,
  type PatchOptions,
  PatchType,
} from "./types.js";
