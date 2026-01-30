/**
 * Variable-length integer encoding/decoding for Git pack files
 *
 * Re-exports from @statewalker/vcs-utils for backwards compatibility.
 */

export {
  appendVarint,
  type PackHeaderResult,
  readOfsVarint,
  readPackHeader,
  readVarint,
  varintSize,
  type VarintResult,
  writeOfsVarint,
  writePackHeader,
  writeVarint,
} from "@statewalker/vcs-utils/encoding";
