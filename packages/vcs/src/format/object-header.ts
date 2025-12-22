/**
 * Git object header encoding/decoding
 *
 * Re-exported from @webrun-vcs/core for backwards compatibility.
 */
export {
  createGitObject,
  encodeHeader,
  encodeObjectHeader,
  encodeObjectHeaderFromCode,
  extractGitObjectContent,
  type ParsedObjectHeader,
  parseHeader,
  stripHeader,
  typeCodeToString,
  typeStringToCode,
} from "@webrun-vcs/core/format";
